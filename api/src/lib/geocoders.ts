import type { Place } from '../../../src/lib/types'

/** The only geocoding `fetch` callers. Requests carry the query, language, limit, layers, a rounded bias and a User-Agent: nothing about the user. */
type Kind = NonNullable<Place['kind']>
export const round2 = (n: number) => Math.round(n * 100) / 100

const userAgent = () => (process.env.GEOCODER_CONTACT ? `PigeonPost/1.0 (${process.env.GEOCODER_CONTACT})` : 'PigeonPost/1.0')
const base = (v: string | undefined) => (v ?? '').replace(/\/+$/, '')

/** Any non-2xx (429, 5xx, ...), network error or timeout throws, so the caller can fall through to the next provider. */
async function getJson(url: URL, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, credentials: 'omit', headers: { 'user-agent': userAgent(), accept: 'application/json' } })
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  return res.json()
}

const isoCc = (v: unknown) => (typeof v === 'string' && /^[a-z]{2}$/i.test(v) ? v.toUpperCase() : undefined)
// trims by code points so a surrogate pair is never split (http.ts str() counts the same way)
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? Array.from(v.trim()).slice(0, 120).join('') : undefined)
const finite = (...n: unknown[]) => n.every((x) => typeof x === 'number' && Number.isFinite(x))
const make = (id: string, name: string, region: string | undefined, country: string | undefined, cc: string, lat: number, lng: number, kind: Kind): Place => ({
  id,
  name,
  ...(region ? { region } : {}),
  country: country ?? cc,
  cc,
  lat: round2(lat),
  lng: round2(lng),
  kind,
})

// --- Photon (OpenStreetMap) ---
const LOCALITY = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'borough', 'quarter', 'locality', 'isolated_dwelling'])
const REGION = new Set(['state', 'county', 'country', 'region', 'province', 'district'])
export const photonKind = (osmKey: unknown, osmValue: unknown): Kind =>
  osmKey === 'place' && LOCALITY.has(osmValue as string)
    ? 'locality'
    : osmKey === 'boundary' || (osmKey === 'place' && REGION.has(osmValue as string))
      ? 'region'
      : 'poi'

type PhotonProps = Record<string, unknown>
type PhotonFeature = { properties?: PhotonProps; geometry?: { coordinates?: unknown[] } }
// Plain addresses and roads. Not `type === 'house'` alone: Photon types the real Eiffel Tower "house" because it has a housenumber.
const isAddress = (p: PhotonProps) => p.osm_key === 'highway' || p.type === 'street' || (p.housenumber !== undefined && (p.osm_key === 'building' || p.osm_key === 'place'))

function fromPhoton(f: PhotonFeature, reverse: boolean): Place | null {
  const p = f.properties ?? {}
  const [lng, lat] = f.geometry?.coordinates ?? []
  const cc = isoCc(p.countrycode)
  if (!cc || !finite(lat, lng) || !/^[NWR]$/.test(String(p.osm_type)) || !finite(p.osm_id)) return null
  const id = `photon:${p.osm_type}${p.osm_id}`
  const region = text(p.state) ?? text(p.county)
  if (!isAddress(p) && text(p.name)) return make(id, text(p.name)!, region, text(p.country), cc, lat as number, lng as number, photonKind(p.osm_key, p.osm_value))
  // A map tap usually lands on a house or a road: name it after its settlement instead.
  const town = reverse ? (text(p.city) ?? text(p.locality) ?? text(p.district) ?? text(p.county)) : undefined
  return town ? make(id, town, region, text(p.country), cc, lat as number, lng as number, 'locality') : null
}
const features = (j: unknown): PhotonFeature[] => {
  const f = (j as { features?: unknown })?.features
  return Array.isArray(f) ? f : []
}

export async function photonSearch(q: string, kind: 'city' | 'any', bias: { lat: number; lng: number } | undefined, signal: AbortSignal): Promise<Place[]> {
  const url = new URL(`${base(process.env.PHOTON_BASE_URL)}/api/`)
  url.searchParams.set('q', q)
  url.searchParams.set('limit', '12') // headroom for results dropped below; the handler returns at most 8
  url.searchParams.set('lang', 'en')
  // Recorded 2026-10-23: towns and villages come back as layer "city" (q=berlin returns Berlin DE plus US towns and villages);
  // adding "district" only adds hamlets and city districts, which are too fine-grained for a home city.
  // For kind=any no layer filter: the real Eiffel Tower is layer "house", so addresses are dropped by isAddress instead.
  if (kind === 'city') for (const l of ['city', 'locality']) url.searchParams.append('layer', l)
  if (bias) {
    url.searchParams.set('lat', String(round2(bias.lat)))
    url.searchParams.set('lon', String(round2(bias.lng)))
  }
  return features(await getJson(url, signal)).flatMap((f) => fromPhoton(f, false) ?? [])
}

export async function photonReverse(lat: number, lng: number, signal: AbortSignal): Promise<Place | null> {
  const url = new URL(`${base(process.env.PHOTON_BASE_URL)}/reverse`)
  url.searchParams.set('lat', String(round2(lat)))
  url.searchParams.set('lon', String(round2(lng)))
  url.searchParams.set('limit', '1')
  url.searchParams.set('lang', 'en')
  const [f] = features(await getJson(url, signal)) // open ocean: no features
  return f ? fromPhoton(f, true) : null
}

// --- Open-Meteo (GeoNames) ---
export async function openMeteoSearch(q: string, signal: AbortSignal): Promise<Place[]> {
  const url = new URL(`${base(process.env.OPEN_METEO_GEOCODING_URL)}/v1/search`)
  url.searchParams.set('name', q)
  url.searchParams.set('count', '10')
  url.searchParams.set('language', 'en')
  url.searchParams.set('format', 'json')
  const results = (await getJson(url, signal)) as { results?: unknown }
  if (!Array.isArray(results?.results)) return [] // no match: Open-Meteo omits `results`
  return results.results.flatMap((r: Record<string, unknown>) => {
    const cc = isoCc(r.country_code)
    const name = text(r.name)
    if (!cc || !name || !finite(r.id, r.latitude, r.longitude)) return []
    const code = String(r.feature_code ?? '')
    const kind: Kind = code.startsWith('PPL') ? 'locality' : code.startsWith('ADM') ? 'region' : 'poi'
    return [make(`om:${r.id}`, name, text(r.admin1), text(r.country), cc, r.latitude as number, r.longitude as number, kind)]
  })
}
