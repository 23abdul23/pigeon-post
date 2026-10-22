import { GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import { createHash } from 'node:crypto'
import type { Place } from '../../../src/lib/types'
import { ddb, tableName } from '../lib/db'
import { openMeteoSearch, photonReverse, photonSearch, round2 } from '../lib/geocoders'
import { bad, fail, json, num, route } from '../lib/http'
import { GEO_GLOBAL_PK, GEO_REVERSE_SK, GEO_SEARCH_SK, geoGlobalUseSk, geoPk, geoUserUseSk, userPk } from '../lib/keys'

const MAX_RESULTS = 8
const USER_DAILY_CAP = 200
const GLOBAL_DAILY_CAP = 8000 // below Open-Meteo's 10,000 free calls a day
const UPSTREAM_TIMEOUT_MS = 2500
const DAY = 86400
const CACHE_TTL = 30 * DAY

const hashKey = (s: string) => geoPk(createHash('sha256').update(s).digest('hex').slice(0, 24))
/** Plain decimal only: no '', exponents, Infinity or hex, which Number() would accept. */
const coord = (v: string | undefined, max: number, what: string) =>
  round2(num(v !== undefined && /^-?\d{1,3}(\.\d{1,12})?$/.test(v) ? Number(v) : NaN, -max, max, what))

/** Counts one uncached upstream lookup against the global budget and the caller's daily cap, atomically: a blocked call counts nowhere. */
async function spend(sub: string) {
  const now = Math.floor(Date.now() / 1000)
  const day = new Date(now * 1000).toISOString().slice(0, 10).replace(/-/g, '')
  const inc = (PK: string, SK: string, cap: number) => ({
    Update: {
      TableName: tableName(),
      Key: { PK, SK },
      UpdateExpression: 'ADD n :one SET #ttl = :ttl',
      ConditionExpression: 'attribute_not_exists(n) OR n < :cap',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':one': 1, ':cap': cap, ':ttl': now + 2 * DAY },
    },
  })
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [inc(GEO_GLOBAL_PK, geoGlobalUseSk(day), GLOBAL_DAILY_CAP), inc(userPk(sub), geoUserUseSk(day), USER_DAILY_CAP)] }))
  } catch (e) {
    if ((e as Error)?.name !== 'TransactionCanceledException') throw e
    const [g, u] = ((e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? []).map((r) => r.Code === 'ConditionalCheckFailed')
    if (u && !g) fail(429, 'daily place search limit reached')
    fail(503, 'places unavailable') // global budget spent (or an unexplained cancel): the client falls back to bundled cities
  }
}

async function cached(PK: string, SK: string) {
  return (await ddb.send(new GetCommand({ TableName: tableName(), Key: { PK, SK } }))).Item
}
async function cache(Item: Record<string, unknown>) {
  try {
    await ddb.send(new PutCommand({ TableName: tableName(), Item: { ...Item, ttl: Math.floor(Date.now() / 1000) + CACHE_TTL } }))
  } catch (e) {
    console.error('places cache put failed', (e as Error).name)
  }
}
const attempt = async <T>(what: string, fn: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await fn()
  } catch (e) {
    console.warn(`${what} failed`, (e as Error).name, (e as Error).message)
    return undefined
  }
}

/** GET /places/search?q&kind=city|any&lat&lng -> `{ places, source }`. Cache, then Photon, then Open-Meteo, then 503. */
export const search = route(async (sub, event) => {
  const qs = event.queryStringParameters ?? {}
  const q = (qs.q ?? '').replace(/\s+/g, ' ').trim()
  if (q.length < 2 || q.length > 80) bad('invalid q')
  const kind = qs.kind ?? 'city'
  if (kind !== 'city' && kind !== 'any') return bad('invalid kind')
  if ((qs.lat === undefined) !== (qs.lng === undefined)) bad('lat and lng go together')
  const bias = qs.lat === undefined ? undefined : { lat: coord(qs.lat, 90, 'lat'), lng: coord(qs.lng, 180, 'lng') }

  // Latin diacritics only (Zürich = zurich); other scripts' marks (e.g. kana dakuten) change the word.
  const norm = q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const PK = hashKey(`${kind}|${norm}|${bias ? `${Math.round(bias.lat)},${Math.round(bias.lng)}` : 'none'}`)
  const hit = await cached(PK, GEO_SEARCH_SK)
  if (Array.isArray(hit?.places)) return json(200, { places: hit.places, source: 'cache' })

  await spend(sub)
  let source: 'photon' | 'open-meteo' = 'photon'
  let found = await attempt('photon', () => photonSearch(q, kind, bias, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)))
  if (!found) {
    source = 'open-meteo'
    found = await attempt('open-meteo', () => openMeteoSearch(q, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)))
  }
  if (!found) return fail(503, 'places unavailable')

  const seen = new Set<string>()
  const places: Place[] = []
  for (const p of found) {
    const k = `${p.name}|${p.region ?? ''}|${p.cc}|${p.lat}|${p.lng}`
    if ((kind === 'city' && p.kind !== 'locality') || seen.has(k)) continue
    seen.add(k)
    places.push(p)
    if (places.length === MAX_RESULTS) break
  }
  await cache({ PK, SK: GEO_SEARCH_SK, places, source })
  return json(200, { places, source })
})

/** GET /places/reverse?lat&lng -> `{ place: Place | null, source }`; coordinates are rounded to 2 decimals before anything else. */
export const reverse = route(async (sub, event) => {
  const qs = event.queryStringParameters ?? {}
  const lat = coord(qs.lat, 90, 'lat')
  const lng = coord(qs.lng, 180, 'lng')
  const PK = hashKey(`${lat}|${lng}`)
  const hit = await cached(PK, GEO_REVERSE_SK)
  if (hit && 'place' in hit) return json(200, { place: hit.place ?? null, source: 'cache' })

  await spend(sub)
  const found = await attempt('photon reverse', () => photonReverse(lat, lng, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)))
  if (found === undefined) return fail(503, 'places unavailable')
  await cache({ PK, SK: GEO_REVERSE_SK, place: found })
  return json(200, { place: found, source: 'photon' })
})

const ROUTES: Record<string, ReturnType<typeof route>> = { 'GET /places/search': search, 'GET /places/reverse': reverse }
/** One Lambda for both place routes (same IAM, same upstreams), dispatching on the API Gateway route key. */
export const handler = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => (ROUTES[event.routeKey] ?? (async () => json(404, { error: 'not found' })))(event)
