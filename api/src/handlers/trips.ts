import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { City, Place } from '../../../src/lib/types'
import { roundCoord } from '../lib/constants'
import { clean, ddb, isConditionFail, tableName, tripOut, type StoredTrip } from '../lib/db'
import { bad, cc, fail, id, isObj, json, num, optStr, parseBody, route, str } from '../lib/http'
import { PROFILE_SK, tripSk, userPk } from '../lib/keys'

async function getTrip(sub: string, tripId: string): Promise<StoredTrip | undefined> {
  const r = await ddb.send(new GetCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: tripSk(tripId) }, ConsistentRead: true }))
  return r.Item && clean<StoredTrip>(r.Item)
}

function parsePlace(v: unknown): Place {
  if (!isObj(v)) return bad('invalid dest')
  return {
    id: str(v.id, 200, 'dest.id'),
    name: str(v.name, 200, 'dest.name'),
    country: str(v.country, 100, 'dest.country'),
    cc: cc(v.cc, 'dest.cc'),
    lat: roundCoord(num(v.lat, -90, 90, 'dest.lat')),
    lng: roundCoord(num(v.lng, -180, 180, 'dest.lng')),
  }
}

/** POST /trips: creates the trip OUTBOUND; idempotent on the client-generated id. */
export const createTrip = route(async (sub, event) => {
  const b = parseBody(event.body)
  const letterIds = b.letterIds ?? []
  if (!Array.isArray(letterIds) || letterIds.length > 20) bad('invalid letterIds')
  // the route starts at the home city as it is now, so every device draws the same route even if home changes later
  const profile = (await ddb.send(new GetCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: PROFILE_SK }, ConsistentRead: true }))).Item
  const origin = (profile?.homeCity as City | undefined) ?? bad('set a home city first')
  const trip: StoredTrip = {
    id: id(b.id, 'id'),
    dest: parsePlace(b.dest),
    origin,
    routeKm: num(b.routeKm, 1, 50000, 'routeKm'),
    friendId: optStr(b.friendId, 64, 'friendId'),
    letterIds: (letterIds as unknown[]).map((l) => id(l, 'letterIds')),
    progressKm: 0,
    status: 'OUTBOUND',
    legs: 0,
    createdMs: Date.now(),
  }
  try {
    await ddb.send(new PutCommand({ TableName: tableName(), Item: { PK: userPk(sub), SK: tripSk(trip.id), ...trip }, ConditionExpression: 'attribute_not_exists(PK)' }))
    return json(200, tripOut(trip))
  } catch (e) {
    if (!isConditionFail(e)) throw e
    return json(200, tripOut((await getTrip(sub, trip.id))!)) // replay: the trip already exists
  }
})

/** POST /trips/{id}/return: a DELIVERED trip flies home (RETURNING, progress reset); replays return the trip unchanged. */
export const returnTrip = route(async (sub, event) => {
  const tripId = id(event.pathParameters?.id, 'trip id')
  try {
    const r = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: userPk(sub), SK: tripSk(tripId) },
        UpdateExpression: 'SET #s = :returning, progressKm = :zero',
        ConditionExpression: '#s = :delivered',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':returning': 'RETURNING', ':zero': 0, ':delivered': 'DELIVERED' },
        ReturnValues: 'ALL_NEW',
      }),
    )
    return json(200, tripOut(clean<StoredTrip>(r.Attributes ?? {})))
  } catch (e) {
    if (!isConditionFail(e)) throw e
    const t = await getTrip(sub, tripId)
    if (!t) return fail(404, 'trip not found')
    if (t.status !== 'RETURNING') return fail(409, `trip is ${t.status}`)
    return json(200, tripOut(t))
  }
})
