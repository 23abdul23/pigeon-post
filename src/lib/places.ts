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
    const timeout = AbortSignal.timeout(SERVER_TIMEOUT_MS)
    const params = new URLSearchParams({ q: q.trim(), kind })
    // privacy: the bias point leaves the device rounded to 2 decimals
    if (bias) {
      params.set('lat', bias[0].toFixed(2))
      params.set('lng', bias[1].toFixed(2))
    }
    try {
      const r = await api<{ places: Place[] }>(`/places/search?${params}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
      return { places: r.places, source: 'server' }
    } catch (e) {
      if (signal?.aborted) throw e
    }
  }
  const places = await searchBundledPlaces(q, BUNDLED_LIMIT)
  signal?.throwIfAborted()
  return { places, source: 'bundled' }
}

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
    const dLng = (r[3] - lng) * Math.cos((lat * Math.PI) / 180)
    const d = dLat * dLat + dLng * dLng
    if (d < bestD) {
      bestD = d
      best = r
    }
  }
  return { ...toPlace(best), distKm: Math.sqrt(bestD) * 111 }
}
