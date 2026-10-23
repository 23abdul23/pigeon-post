import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import type { City, SessionLog, Stamp, Story, Trip } from '../../../src/lib/types'
import { clampKm } from '../lib/clamp'
import { ddb, isConditionFail, tableName, type StoredTrip } from '../lib/db'
import { IMPORT_MAX_BODY, IMPORT_MAX_SESSIONS, IMPORT_MAX_STAMPS, IMPORT_MAX_STORIES } from '../lib/constants'
import { bad, cc, fail, HttpError, id, isObj, json, num, parseBody, route, str } from '../lib/http'
import { PROFILE_SK, sessionSk, stampSk, storySk, tripSk, userPk } from '../lib/keys'
import { queryAll } from '../lib/letters'
import { parseProfileFields, saveProfile } from './me'
import { REASONS, parseStory } from './sessions'
import { buildState } from './state'
import { parsePlace } from './trips'

const CONCURRENCY = 10
// PAUSED is client-only (the flight API knows OUTBOUND/RETURNING): an imported paused trip resumes outbound
const STATUSES: readonly unknown[] = ['OUTBOUND', 'DELIVERED', 'RETURNING', 'PAUSED', 'DONE'] satisfies Trip['status'][]

const list = (v: unknown, max: number, what: string): unknown[] => {
  if (v === undefined) return []
  return Array.isArray(v) && v.length <= max ? v : bad(`invalid ${what} (at most ${max})`)
}

function parseImportedStory(v: unknown): Story {
  const s = parseStory(v) // same validators as the session endpoint (coordinates rounded)
  const o = v as Record<string, unknown>
  if (typeof o.saved !== 'boolean') bad('invalid story.saved')
  return { ...s, dateMs: num(o.dateMs, 0, 1e14, 'story.dateMs'), saved: o.saved as boolean, km: num(o.km, 0, 100_000, 'story.km') }
}

function parseStamp(v: unknown): Stamp {
  if (!isObj(v)) return bad('invalid stamp')
  return { cc: cc(v.cc, 'stamp.cc'), country: str(v.country, 100, 'stamp.country'), firstMs: num(v.firstMs, 0, 1e14, 'stamp.firstMs'), visits: Math.round(num(v.visits, 1, 10_000, 'stamp.visits')) }
}

function parseSession(v: unknown): SessionLog {
  if (!isObj(v)) return bad('invalid session')
  if (!REASONS.includes(v.reason)) bad('invalid session.reason')
  const startMs = num(v.startMs, 0, 1e14, 'session.startMs')
  const endMs = num(v.endMs, 0, 1e14, 'session.endMs')
  return {
    id: id(v.id, 'session.id'),
    tripId: id(v.tripId, 'session.tripId'),
    startMs,
    endMs,
    // clamped like POST /trips/{id}/sessions: the length of the session caps its distance (an end before the start gives 0)
    km: clampKm(num(v.km, 0, 1e6, 'session.km'), startMs, endMs),
    reason: v.reason as SessionLog['reason'],
  }
}

/** The trip without `route`/`origin` (the server stores the home city as origin; the client recomputes the route). friendId and letterIds are not imported: local friends and letters do not exist on the server. */
function parseTrip(v: unknown): Omit<StoredTrip, 'origin' | 'createdMs'> {
  if (!isObj(v)) return bad('invalid trip')
  if (!STATUSES.includes(v.status)) bad('invalid trip.status')
  const routeKm = num(v.routeKm, 1, 50000, 'trip.routeKm')
  return {
    id: id(v.id, 'trip.id'),
    dest: parsePlace(v.dest),
    routeKm,
    progressKm: num(v.progressKm, 0, routeKm, 'trip.progressKm'),
    status: v.status === 'PAUSED' ? 'OUTBOUND' : (v.status as Trip['status']),
    legs: Math.round(num(v.legs, 0, 1e5, 'trip.legs')),
    letterIds: [],
  }
}

/**
 * Writes each item with `attribute_not_exists(PK)`, ten at a time. An item that is already there (a re-run after a partial
 * failure, or the server's own copy) is skipped, never overwritten. Individual PutItems rather than BatchWriteItem, which cannot be conditional.
 */
async function putNew(items: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(
      items.slice(i, i + CONCURRENCY).map(async (Item) => {
        try {
          await ddb.send(new PutCommand({ TableName: tableName(), Item, ConditionExpression: 'attribute_not_exists(PK)' }))
        } catch (e) {
          if (!isConditionFail(e)) throw e
        }
      }),
    )
  }
}

/**
 * POST /import: uploads what this device stored locally before the account had any server data. Nothing on the server is
 * overwritten and every write is conditional, so it can be re-run after a crash. The profile is written LAST, together with
 * `importedAt`: until then GET /state keeps returning `profile: null`, which is what makes the client retry. Once it exists
 * (importedAt set), later imports are refused with 409.
 */
export const handler = route(async (sub, event) => {
  if ((event.body?.length ?? 0) > IMPORT_MAX_BODY) return fail(413, 'import too large')
  const b = parseBody(event.body)
  const fields = b.profile === undefined ? {} : isObj(b.profile) ? parseProfileFields(b.profile) : bad('invalid profile')
  // An invalid item is skipped (and logged), never the whole import: a 400 here would leave the device's data unsynced for good.
  const skipped: string[] = []
  const valid = <T>(what: string, items: unknown[], parse: (v: unknown) => T): T[] =>
    items.flatMap((v) => {
      try {
        return [parse(v)]
      } catch (e) {
        if (!(e instanceof HttpError)) throw e
        skipped.push(`${what}: ${e.message}`)
        return []
      }
    })
  const stories = valid('story', list(b.stories, IMPORT_MAX_STORIES, 'stories'), parseImportedStory)
  const stamps = valid('stamp', list(b.stamps, IMPORT_MAX_STAMPS, 'stamps'), parseStamp)
  const sessions = valid('session', list(b.sessions, IMPORT_MAX_SESSIONS, 'sessions'), parseSession)
  let trip: ReturnType<typeof parseTrip> | undefined = b.trip === undefined || b.trip === null ? undefined : valid('trip', [b.trip], parseTrip)[0]

  const PK = userPk(sub)
  const existing = (await ddb.send(new GetCommand({ TableName: tableName(), Key: { PK, SK: PROFILE_SK }, ConsistentRead: true }))).Item
  if (existing?.importedAt) return fail(409, 'already imported')

  // the server's own profile fields win; the import only fills what is missing
  for (const k of Object.keys(fields)) if (existing?.[k] !== undefined) delete fields[k]
  const origin = (existing?.homeCity ?? fields.homeCity) as City | undefined
  if (trip && !origin) {
    skipped.push('trip: a trip needs a home city')
    trip = undefined
  }
  if (skipped.length) console.warn('import skipped invalid items', skipped.length, skipped.slice(0, 20))

  // an existing server trip (of any id) means the imported one is dropped
  if (trip && !(await queryAll<{ SK: string }>(PK, 'TRIP#')).some((t) => t.SK !== tripSk(trip.id))) {
    await putNew([{ PK, SK: tripSk(trip.id), ...trip, origin, createdMs: Date.now() }])
  }
  await putNew([
    ...stories.map((s) => ({ PK, SK: storySk(s.id), ...s })),
    ...stamps.map((s) => ({ PK, SK: stampSk(s.cc), ...s })),
    ...sessions.map((s) => ({ PK, SK: sessionSk(s.id), ...s })),
  ])

  try {
    // creates the profile (and its invite code) if needed, same path as PUT /me
    await saveProfile(sub, event.requestContext.authorizer.jwt.claims.email, fields, Date.now())
  } catch (e) {
    if (isConditionFail(e)) return fail(409, 'already imported') // a concurrent import finished first
    throw e
  }
  return json(200, await buildState(sub))
})
