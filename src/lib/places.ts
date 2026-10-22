import type { City, Place } from './store'
import { countryName, type Pt } from './geo'
import { api } from './api'
import { COGNITO_CONFIGURED } from './auth'

type Row = [name: string, cc: string, lat: number, lng: number, pop: number]

let rows: Row[] | null = null

async function load(): Promise<Row[]> {
  if (!rows) rows = (await import('../data/cities.json')).default as Row[]
  return rows
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function toPlace(r: Row): Place {
  return { id: `${r[1]}-${r[0]}-${r[2]}`, name: r[0], country: countryName(r[1]), cc: r[1], lat: r[2], lng: r[3] }
}

/** Prefix search over bundled GeoNames cities, most populous first (diacritic-insensitive). */
export async function searchBundledPlaces(q: string, limit = 6): Promise<Place[]> {
  const needle = norm(q.trim())
  if (needle.length < 2) return []
  const all = await load()
  const out: Place[] = []
  for (const r of all) {
    if (norm(r[0]).startsWith(needle)) {
      out.push(toPlace(r))
      if (out.length >= limit) break
    }
  }
  return out
}

export type PlaceKind = 'city' | 'any'
export type PlaceSource = 'server' | 'bundled'
export type PlaceResults = { places: Place[]; source: PlaceSource }

const SERVER_TIMEOUT_MS = 3500
const BUNDLED_LIMIT = 8

/**
 * Server-first place search (`GET /places/search`, Photon then Open-Meteo). Any server failure (429, 503, timeout,
 * offline) or no Cognito (demo / offline dev) falls back to the bundled cities with source 'bundled'.
 * Rejects with an AbortError only when the caller's `signal` aborts.
 */
export async function searchPlaces(q: string, opts: { kind: PlaceKind; signal?: AbortSignal; bias?: Pt }): Promise<PlaceResults> {
  const { kind, signal, bias } = opts
  if (COGNITO_CONFIGURED) {
    const params = new URLSearchParams({ q: q.trim(), kind })
    // privacy: the bias point leaves the device rounded to 2 decimals
    if (bias) {
      params.set('lat', bias[0].toFixed(2))
      params.set('lng', bias[1].toFixed(2))
    }
    // a plain controller instead of AbortSignal.any/timeout, which older Safari lacks
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort(signal!.reason)
    const timer = setTimeout(() => ctrl.abort(new DOMException('place search timed out', 'TimeoutError')), SERVER_TIMEOUT_MS)
    try {
      if (signal?.aborted) onAbort()
      signal?.addEventListener('abort', onAbort)
      const r = await api<{ places: Place[] }>(`/places/search?${params}`, { signal: ctrl.signal })
      return { places: r.places, source: 'server' }
    } catch (e) {
      if (signal?.aborted) throw e
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
  const places = await searchBundledPlaces(q, BUNDLED_LIMIT)
  signal?.throwIfAborted()
  return { places, source: 'bundled' }
}

/** "Name, Region, Country" (region when known); the same text for a search result and for a stored City. */
export const placeLabel = (p: { name: string; region?: string; country: string }) => [p.name, p.region, p.country].filter(Boolean).join(', ')

export const toCity = (p: Place): City => ({
  name: p.name,
  ...(p.region && { region: p.region }),
  country: p.country,
  cc: p.cc,
  lat: p.lat,
  lng: p.lng,
  placeId: p.id,
})

export async function findCity(name: string): Promise<Place | undefined> {
  return (await searchBundledPlaces(name, 1))[0]
}

/** Closest bundled city to a coordinate; always resolves because the dataset is global. */
export async function nearestCity(lat: number, lng: number): Promise<Place & { distKm: number }> {
  const all = await load()
  let best = all[0]
  let bestD = Infinity
  for (const r of all) {
    const dLat = r[2] - lat
    const dLng = (((r[3] - lng + 540) % 360) - 180) * Math.cos((lat * Math.PI) / 180) // shortest way round, also for unwrapped route longitudes
    const d = dLat * dLat + dLng * dLng
    if (d < bestD) {
      bestD = d
      best = r
    }
  }
  return { ...toPlace(best), distKm: Math.sqrt(bestD) * 111 }
}

const round2 = (x: number) => Math.round(x * 100) / 100

export type ReverseResult = { place: Place | null; source: PlaceSource; approxKm?: number }

/**
 * What is at a map tap (`GET /places/reverse`). Coordinates are rounded to 2 decimals (about 1 km) before anything sees them.
 * Server `place: null` means open water. Any server failure, or no Cognito, gives the nearest bundled city with `approxKm`.
 * `kind: 'city'` (home) never returns a landmark or region: those fall through to the nearest bundled city.
 */
export async function reversePlace(lat: number, lng: number, kind: PlaceKind = 'any'): Promise<ReverseResult> {
  lat = round2(lat)
  lng = round2(lng)
  if (COGNITO_CONFIGURED) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new DOMException('reverse lookup timed out', 'TimeoutError')), SERVER_TIMEOUT_MS)
    try {
      const params = new URLSearchParams({ lat: lat.toFixed(2), lng: lng.toFixed(2) })
      const { place } = await api<{ place: Place | null }>(`/places/reverse?${params}`, { signal: ctrl.signal })
      if (!place) return { place: null, source: 'server' }
      if (kind === 'any' || !place.kind || place.kind === 'locality') return { place, source: 'server' }
    } catch {
      // 400, 429, 503, timeout, offline: the bundled cities below
    } finally {
      clearTimeout(timer)
    }
  }
  const { distKm, ...place } = await nearestCity(lat, lng)
  return { place, source: 'bundled', approxKm: distKm }
}

export type LocateResult = ({ ok: true } & ReverseResult) | { ok: false; message: string }

/** "Use my location": asks the browser once, keeps only the rounded position, and names it at city level. Never stores the position. */
export async function locate(geo: Pick<Geolocation, 'getCurrentPosition'> | undefined, reverse: typeof reversePlace = reversePlace): Promise<LocateResult> {
  const fallback = "We couldn't find your location. Search for your city instead."
  if (!geo) return { ok: false, message: fallback }
  let at: [number, number]
  try {
    at = await new Promise((res, rej) =>
      geo.getCurrentPosition((p) => res([round2(p.coords.latitude), round2(p.coords.longitude)]), rej, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }),
    )
  } catch (e) {
    const denied = (e as GeolocationPositionError | undefined)?.code === 1
    return { ok: false, message: denied ? 'Location permission is off. Search for your city instead, or allow location in your browser settings.' : fallback }
  }
  return { ok: true, ...(await reverse(at[0], at[1], 'city')) }
}
