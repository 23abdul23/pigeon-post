import { countryName, pointAtKm, wrapLng, type Pt } from './geo'

export type CountryHit = { cc: string; country: string; km: number }

/** Countries the route enters, in order, sampled every stepKm. Ocean (null) never emits and never resets the previous country. */
export function countryEntries(route: Pt[], routeKm: number, countryAt: (lat: number, lng: number) => string | null, stepKm = 25): CountryHit[] {
  const hits: CountryHit[] = []
  if (route.length < 2 || !(routeKm > 0)) return hits
  let prev: string | null = null
  for (let km = 0; ; km = Math.min(routeKm, km + stepKm)) {
    const [lat, lng] = pointAtKm(route, km).pt
    const cc = countryAt(lat, wrapLng(lng))
    if (cc && cc !== prev) {
      hits.push({ cc, country: countryName(cc), km })
      prev = cc
    }
    if (km >= routeKm) break
  }
  return hits
}

const firstPerCc = (hits: CountryHit[]) => hits.filter((h, i) => hits.findIndex((x) => x.cc === h.cc) === i)

/** Entries strictly after fromKm up to toKm: the country the slot started in is not re-announced. */
export function enteredBetween(hits: CountryHit[], fromKm: number, toKm: number): CountryHit[] {
  return firstPerCc(hits.filter((h) => h.km > fromKm && h.km <= toKm).sort((a, b) => a.km - b.km))
}

/** Every country over [fromKm, toKm]: the one in force at fromKm plus the entries after it. */
export function coveredBetween(hits: CountryHit[], fromKm: number, toKm: number): CountryHit[] {
  const start = [...hits].reverse().find((h) => h.km <= fromKm)
  return firstPerCc([...(start ? [start] : []), ...enteredBetween(hits, fromKm, toKm)])
}
