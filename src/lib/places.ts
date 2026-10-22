import type { City, Place } from './store'
import { countryName } from './geo'

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

/** Prefix search over bundled GeoNames cities, most populous first. */
export async function searchPlaces(q: string, limit = 6): Promise<Place[]> {
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

export const toCity = (p: Place): City => ({ name: p.name, country: p.country, cc: p.cc, lat: p.lat, lng: p.lng })

export async function findCity(name: string): Promise<Place | undefined> {
  return (await searchPlaces(name, 1))[0]
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
