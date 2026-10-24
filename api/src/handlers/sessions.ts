import { DeleteCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { Letter, SessionLog, SessionResult, Stamp, Story, StoryExtras, Trip } from '../../../src/lib/types'
import { clampKm } from '../lib/clamp'
import { roundCoord } from '../lib/constants'
import { clean, ddb, isConditionFail, tableName, tripOut, type StoredTrip } from '../lib/db'
import { bad, cc, fail, id, isObj, json, num, optStr, parseBody, route, str } from '../lib/http'
import { flightSk, letterSk, sentSk, sessionSk, stampSk, storySk, tripSk, userPk } from '../lib/keys'
import { letterOut, move, queryAll, type LetterRow, type TransactItem } from '../lib/letters'
import { notifyLetterArrived } from '../lib/notify'

// A transaction holds at most 100 items: 5 for the session itself (session, trip, stamp, story, flight), 2 per letter (both copies).
// ponytail: letters beyond the cap keep their status (a sender's extra CARRIED letters go on the next visit); split into a follow-up step if real mailboxes get that big.
const MAX_LETTER_MOVES = 47

/**
 * The arrival rule (Flow.md section 6), run once: only on the session that takes the trip to routeKm.
 * At the friend's city my CARRIED letters to them are DELIVERED and their WAITING letters to me ride home (CARRIED, tagged
 * with this trip); arriving home delivers exactly the letters this trip picked up.
 */
async function arrival(sub: string, trip: StoredTrip): Promise<{ delivered: Letter[]; pickedUp: Letter[]; items: TransactItem[] }> {
  const inbox = await queryAll<LetterRow>(userPk(sub), 'LETTER#')
  let deliver: LetterRow[] = []
  let pickUp: LetterRow[] = []
  if (trip.status === 'RETURNING') deliver = inbox.filter((l) => l.status === 'CARRIED' && l.pickedUpBy === trip.id)
  else if (trip.friendId) {
    const sent = await queryAll<LetterRow>(userPk(sub), 'SENT#')
    deliver = sent.filter((l) => l.status === 'CARRIED' && l.toId === trip.friendId)
    pickUp = inbox.filter((l) => l.status === 'WAITING' && l.fromId === trip.friendId)
  }
  // a letter whose other copy is gone (account deletion) is skipped: moving it would cancel every attempt and the flight would never land
  const get = async (PK: string, SK: string) => (await ddb.send(new GetCommand({ TableName: tableName(), Key: { PK, SK }, ConsistentRead: true }))).Item
  // the other copy is the one outside my partition: the recipient's LETTER# for a letter I sent, the sender's SENT# otherwise
  const hasOtherCopy = async (l: LetterRow) => !!(await (l.fromId === sub ? get(userPk(l.toId), letterSk(l.id)) : get(userPk(l.fromId), sentSk(l.id))))
  const mirrored = async (ls: LetterRow[]) => (await Promise.all(ls.map(async (l) => ((await hasOtherCopy(l)) ? l : undefined)))).filter((l): l is LetterRow => !!l)
  deliver = await mirrored(deliver.slice(0, MAX_LETTER_MOVES))
  pickUp = await mirrored(pickUp.slice(0, MAX_LETTER_MOVES - deliver.length))
  return {
    delivered: deliver.map((l) => letterOut({ ...l, status: 'DELIVERED' }, sub)),
    pickedUp: pickUp.map((l) => letterOut({ ...l, status: 'CARRIED' }, sub)),
    items: [...deliver.flatMap((l) => move(l, 'CARRIED', 'DELIVERED')), ...pickUp.flatMap((l) => move(l, 'WAITING', 'CARRIED', trip.id))],
  }
}

export const REASONS: readonly unknown[] = ['completed', 'left', 'ended'] satisfies SessionLog['reason'][]
const LENSES: readonly unknown[] = ['Legend', 'Food', 'Hidden spot', 'Nature', 'History'] satisfies Story['lens'][]

const KINDS = ['Bird', 'Plant', 'Mammal', 'Reptile', 'Amphibian', 'Insect', 'Fungus', 'Other']

/** Lenient: extras are decoration, so anything invalid is dropped instead of rejecting the session. */
export function sanitizeExtras(v: unknown): StoryExtras | undefined {
  if (!isObj(v)) return undefined
  const s = (x: unknown, max: number) => (typeof x === 'string' && x.trim() && Array.from(x.trim()).length <= max ? x.trim() : undefined)
  const url = (x: unknown) => (typeof x === 'string' && x.length <= 500 && x.startsWith('https://') ? x : undefined)
  const list = <T>(x: unknown, max: number, f: (i: Record<string, unknown>) => T | undefined): T[] | undefined => {
    const out = (Array.isArray(x) ? x : []).flatMap((i) => (isObj(i) ? [f(i)] : [])).filter((i): i is NonNullable<T> => i != null).slice(0, max)
    return out.length ? out : undefined
  }
  const nearby = list(v.nearby, 5, (i) => {
    const title = s(i.title, 120)
    return title ? { title, blurb: s(i.blurb, 300), photo: url(i.photo), url: url(i.url) } : undefined
  })
  const wildlife = list(v.wildlife, 8, (i) => {
    const name = s(i.name, 120)
    return name ? { name, kind: (KINDS.includes(i.kind as string) ? i.kind : 'Other') as NonNullable<StoryExtras['wildlife']>[number]['kind'], photo: url(i.photo) } : undefined
  })
  const p = isObj(v.people) ? v.people : {}
  const langs = (Array.isArray(p.languages) ? p.languages : []).map((l) => s(l, 120)).filter((l): l is string => !!l).slice(0, 6)
  const people = {
    capital: s(p.capital, 120),
    population: typeof p.population === 'number' && Number.isFinite(p.population) && p.population >= 0 ? p.population : undefined,
    languages: langs.length ? langs : undefined,
    currency: s(p.currency, 120),
    demonym: s(p.demonym, 120),
  }
  const out: StoryExtras = { nearby, wildlife, people: Object.values(people).some((x) => x !== undefined) ? people : undefined, culture: s(v.culture, 600) }
  // JSON-style: undefined keys are dropped so stored items and responses stay clean
  const clean = JSON.parse(JSON.stringify(out)) as StoryExtras
  return Object.keys(clean).length ? clean : undefined
}

export function parseStory(v: unknown): Omit<Story, 'dateMs' | 'saved' | 'km'> {
  if (!isObj(v)) return bad('invalid story')
  const birds = v.birds ?? []
  if (!Array.isArray(birds) || birds.length > 10) bad('invalid story.birds')
  if (!LENSES.includes(v.lens)) bad('invalid story.lens')
  return {
    id: id(v.id, 'story.id'),
    place: str(v.place, 200, 'story.place'),
    region: optStr(v.region, 200, 'story.region'),
    country: str(v.country, 100, 'story.country'),
    cc: cc(v.cc, 'story.cc'),
    lens: v.lens as Story['lens'],
    text: str(v.text, 2000, 'story.text'),
    photo: optStr(v.photo, 1000, 'story.photo'),
    sourceUrl: optStr(v.sourceUrl, 1000, 'story.sourceUrl'),
    birds: (birds as unknown[]).map((b) => str(b, 100, 'story.birds')),
    extras: sanitizeExtras(v.extras),
    lat: roundCoord(num(v.lat, -90, 90, 'story.lat')),
    lng: roundCoord(num(v.lng, -180, 180, 'story.lng')),
  }
}

/**
 * POST /trips/{id}/sessions: records a landed session. One transaction writes the session, trip progress, stamp, story and,
 * on arrival, the letter handovers.
 * Idempotent on the client-generated session id: a replay returns the stored result and counts nothing twice.
 */
export const handler = route(async (sub, event) => {
  const tripId = id(event.pathParameters?.id, 'trip id')
  const b = parseBody(event.body)
  const sessionId = id(b.id, 'id')
  const startMs = num(b.startMs, 0, 1e14, 'startMs')
  const endMs = num(b.endMs, 0, 1e14, 'endMs')
  if (!REASONS.includes(b.reason)) bad('invalid reason')
  const kmGained = num(b.kmGained, 0, 1e6, 'kmGained')
  const storyIn = parseStory(b.story)

  const PK = userPk(sub)
  const TableName = tableName()
  const get = async (SK: string) => (await ddb.send(new GetCommand({ TableName, Key: { PK, SK }, ConsistentRead: true }))).Item
  const replay = async () => {
    const s = await get(sessionSk(sessionId))
    if (!s) return undefined
    if (s.tripId !== tripId) return fail(409, 'session id belongs to another trip')
    // best effort: a heartbeat that raced the first landing may have recreated this flight; only that exact flight is cleared
    try {
      await ddb.send(new DeleteCommand({ TableName, Key: { PK, SK: flightSk() }, ConditionExpression: 'tripId = :t AND startMs = :s', ExpressionAttributeValues: { ':t': tripId, ':s': s.startMs } }))
    } catch (e) {
      if (!isConditionFail(e)) throw e
    }
    // written by POST /import, which stores no result: the client drops the op (it is already recorded)
    if (!s.result) return fail(409, 'session already recorded')
    return json(200, s.result)
  }

  // A cancelled transaction (lost lock to another tab/device, transaction conflict, throttling) is retried on fresh
  // reads; session-id idempotency keeps that safe. Still failing: 503, which the client outbox retries later.
  for (let attempt = 0; attempt < 3; attempt++) {
    const seen = await replay()
    if (seen) return seen
    const tripRow = await get(tripSk(tripId)) // the caller's own partition, so someone else's trip is simply not there
    if (!tripRow) return fail(404, 'trip not found')
    const trip = clean<StoredTrip>(tripRow)
    const stampRow = await get(stampSk(storyIn.cc))
    const flightRow = await get(flightSk())

    const now = Date.now()
    const progressKm = Math.min(trip.routeKm, trip.progressKm + clampKm(kmGained, startMs, endMs))
    const arrived = progressKm >= trip.routeKm
    // Same rules as the client's landSession (src/lib/flight.ts).
    const status: Trip['status'] = !arrived ? trip.status : trip.status === 'RETURNING' || !trip.friendId ? 'DONE' : 'DELIVERED'
    const nextTrip: StoredTrip = { ...trip, progressKm, legs: trip.legs + 1, status }
    const stamp: Stamp = stampRow
      ? { ...clean<Stamp>(stampRow), visits: Number(stampRow.visits) + 1 }
      : { cc: storyIn.cc, country: storyIn.country, firstMs: now, visits: 1 }
    const story: Story = { ...storyIn, km: progressKm, dateMs: now, saved: false }
    const log: SessionLog = { id: sessionId, tripId, startMs, endMs, km: progressKm - trip.progressKm, reason: b.reason as SessionLog['reason'] }
    // a session on a trip that had already arrived moves no letters
    const letters = arrived && trip.progressKm < trip.routeKm ? await arrival(sub, trip) : { delivered: [], pickedUp: [], items: [] }
    // stored on the session row so a replay returns it unchanged
    const result: SessionResult = { trip: tripOut(nextTrip), stamp, story, delivered: letters.delivered, pickedUp: letters.pickedUp }

    const items: TransactItem[] = [
      { Put: { TableName, Item: { PK, SK: sessionSk(sessionId), ...log, result }, ConditionExpression: 'attribute_not_exists(PK)' } },
      // optimistic lock on what we read: a concurrent session or return makes this attempt retry instead of overwriting it
      {
        Put: {
          TableName,
          Item: { PK, SK: tripSk(tripId), ...nextTrip },
          ConditionExpression: 'legs = :legs AND #s = :status AND progressKm = :progress',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':legs': trip.legs, ':status': trip.status, ':progress': trip.progressKm },
        },
      },
      {
        Put: {
          TableName,
          Item: { PK, SK: stampSk(stamp.cc), ...stamp },
          ...(stampRow ? { ConditionExpression: 'visits = :visits', ExpressionAttributeValues: { ':visits': stampRow.visits } } : { ConditionExpression: 'attribute_not_exists(PK)' }),
        },
      },
      { Put: { TableName, Item: { PK, SK: storySk(story.id), ...story }, ConditionExpression: 'attribute_not_exists(PK)' } },
      // landing ends this trip's flight; another trip's flight is left alone. Both are checked against what we read, so a
      // flight started or replaced meanwhile makes this attempt retry instead of deleting the wrong one or missing it.
      flightRow && flightRow.tripId !== tripId
        ? { ConditionCheck: { TableName, Key: { PK, SK: flightSk() }, ConditionExpression: 'tripId <> :t', ExpressionAttributeValues: { ':t': tripId } } }
        : { Delete: { TableName, Key: { PK, SK: flightSk() }, ConditionExpression: 'attribute_not_exists(PK) OR tripId = :t', ExpressionAttributeValues: { ':t': tripId } } },
      // each letter write is conditional on its current status: a letter that moved meanwhile cancels this attempt, which re-reads
      ...letters.items,
    ]

    try {
      await ddb.send(new TransactWriteCommand({ TransactItems: items }))
      // one email per recipient (an arrival hands letters to one person); a replay returned above, so this runs once
      const to = new Map(result.delivered.map((l) => [l.toId === 'me' ? sub : l.toId, l.fromName]))
      await Promise.all([...to].map(([toId, fromName]) => notifyLetterArrived(toId, fromName)))
      return json(200, result)
    } catch (e) {
      if ((e as Error)?.name !== 'TransactionCanceledException') throw e
    }
  }
  return fail(503, 'trip is busy; retry')
})
