import { bad, fail, json, route } from '../lib/http'

const FREE_HOST = 'https://api.open-meteo.com/v1/forecast'
// Open-Meteo's free tier is non-commercial; the paid plan has its own host and takes the key as `apikey`.
const COMMERCIAL_HOST = 'https://customer-api.open-meteo.com/v1/forecast'
const UPSTREAM_TIMEOUT_MS = 4000
const TTL_MS = 10 * 60_000
const MAX_CELLS = 3000

type Wind = { speedKmh: number; fromDeg: number; tempC: number }
/** Per rounded 0.1 degree cell; Map keeps insertion order, so the first key is the oldest. Lives as long as the warm Lambda. */
const cache = new Map<string, { at: number; wind: Wind }>()

/** Plain decimal only (no '', exponents, Infinity or hex, which Number() would accept), then range-checked and rounded to 1 decimal. */
function coord(v: string | undefined, max: number, what: string) {
  const n = v !== undefined && /^-?\d{1,3}(\.\d{1,12})?$/.test(v) ? Number(v) : NaN
  if (!Number.isFinite(n) || n < -max || n > max) bad(`invalid ${what}`)
  return Math.round(n * 10) / 10 + 0 // + 0 turns -0 into 0
}

async function fetchWind(lat: number, lng: number): Promise<Wind> {
  const key = process.env.OPEN_METEO_API_KEY
  const url = new URL(key ? COMMERCIAL_HOST : FREE_HOST)
  url.searchParams.set('latitude', lat.toFixed(1))
  url.searchParams.set('longitude', lng.toFixed(1))
  url.searchParams.set('current', 'temperature_2m,wind_speed_10m,wind_direction_10m')
  if (key) url.searchParams.set('apikey', key)
  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), credentials: 'omit', headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  const c = ((await res.json()) as { current?: Record<string, unknown> })?.current
  const { wind_speed_10m: speedKmh, wind_direction_10m: fromDeg, temperature_2m: tempC } = c ?? {}
  if (![speedKmh, fromDeg, tempC].every((x) => typeof x === 'number' && Number.isFinite(x))) throw new Error('malformed upstream')
  return { speedKmh, fromDeg, tempC } as Wind
}

/** GET /weather?lat&lng -> `{ speedKmh, fromDeg, tempC }`. Coordinates are rounded to 1 decimal; cached 10 minutes per cell; upstream trouble is a 502. */
export const handler = route(async (_sub, event) => {
  const qs = event.queryStringParameters ?? {}
  const lat = coord(qs.lat, 90, 'lat')
  const lng = coord(qs.lng, 180, 'lng')
  const cell = `${lat},${lng}`
  const now = Date.now()
  const hit = cache.get(cell)
  if (hit && now - hit.at < TTL_MS) return json(200, hit.wind)
  let wind: Wind
  try {
    wind = await fetchWind(lat, lng)
  } catch (e) {
    // name only: the message or URL could carry the key
    console.warn('weather upstream failed', (e as Error)?.name)
    return fail(502, 'weather unavailable')
  }
  cache.delete(cell)
  cache.set(cell, { at: now, wind })
  while (cache.size > MAX_CELLS) cache.delete(cache.keys().next().value!)
  return json(200, wind)
})
