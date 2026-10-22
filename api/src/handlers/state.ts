import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { Friend, ServerState, SessionLog, Stamp, Story } from '../../../src/lib/types'
import { clean, ddb, flightOut, profileOut, tableName, tripOut, type StoredTrip } from '../lib/db'
import { json, route } from '../lib/http'
import { flightSk, PROFILE_SK, userPk } from '../lib/keys'
import { letterOut, type LetterRow } from '../lib/letters'

export async function buildState(sub: string): Promise<ServerState> {
  const s: ServerState = { profile: null, trip: null, stories: [], letters: [], friends: [], stamps: [], sessions: [], flight: null, serverTime: Date.now() }
  let trip: StoredTrip | undefined
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await ddb.send(
      new QueryCommand({ TableName: tableName(), ConsistentRead: true, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': userPk(sub) }, ExclusiveStartKey }),
    )
    for (const item of page.Items ?? []) {
      const sk = String(item.SK)
      if (sk === PROFILE_SK) s.profile = profileOut(item)
      // TTL deletes lazily, so an expired flight can still be read
      else if (sk === flightSk()) s.flight = Number(item.ttl) * 1000 > s.serverTime ? flightOut(item) : null
      else if (sk.startsWith('TRIP#')) {
        const t = clean<StoredTrip>(item)
        if (!trip || t.createdMs > trip.createdMs) trip = t // the newest trip is the current one
      } else if (sk.startsWith('SESSION#')) {
        const { result: _r, ...log } = clean<SessionLog & { result: unknown }>(item)
        s.sessions.push(log)
      } else if (sk.startsWith('STORY#')) s.stories.push(clean<Story>(item))
      else if (sk.startsWith('STAMP#')) s.stamps.push(clean<Stamp>(item))
      else if (sk.startsWith('FRIEND#')) s.friends.push(clean<Friend>(item))
      else if (sk.startsWith('LETTER#') || sk.startsWith('SENT#')) s.letters.push(letterOut(item as LetterRow, sub)) // received and sent copies
    }
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey)

  s.trip = trip ? tripOut(trip) : null
  // the client's order: newest stories and sessions first, stamps in the order they were earned
  s.stories.sort((a, b) => b.dateMs - a.dateMs)
  s.sessions.sort((a, b) => b.endMs - a.endMs)
  s.stamps.sort((a, b) => a.firstMs - b.firstMs)
  s.letters.sort((a, b) => b.dateMs - a.dateMs)
  return s
}

export const handler = route(async (sub) => json(200, await buildState(sub)))
