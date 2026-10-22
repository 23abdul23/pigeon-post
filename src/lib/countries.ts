import data from '../data/countries.json'
import { haversineKm } from './geo'

type Country = { cc: string; name: string; lat: number; lng: number; region: string }
export const COUNTRIES = data as Country[] // 194 independent countries, from the world-countries dataset

/** Countries not yet stamped, nearest to `from` first: the "next up" tiles on the passport. */
export function nextCountries(visited: Set<string>, from: { lat: number; lng: number }, n: number) {
  return COUNTRIES.filter((c) => !visited.has(c.cc))
    .map((c) => ({ ...c, d: haversineKm(from, { lat: c.lat, lng: c.lng }) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
}
