import { describe, expect, it } from 'vitest'
import { coveredBetween, countryEntries, enteredBetween, type CountryHit } from '../src/lib/countriesAlong'
import { loadCountryAt } from '../src/lib/countryAt'
import { routeLengthKm, type Pt } from '../src/lib/geo'

// along the equator 1 degree of longitude is ~111.2 km
const route: Pt[] = [[0, 0], [0, 9]]
const km = routeLengthKm(route)
const bands = (spec: [number, string | null][]) => (_lat: number, lng: number) => spec.find(([to]) => lng < to)?.[1] ?? null

describe('countryEntries', () => {
  it('lists A, B, C in order with the km they are entered at', () => {
    const hits = countryEntries(route, km, bands([[3, 'AA'], [6, 'BB'], [10, 'CC']]))
    expect(hits.map((h) => h.cc)).toEqual(['AA', 'BB', 'CC'])
    expect(hits[0].km).toBe(0)
    expect(hits[1].km).toBeGreaterThan(3 * 111.2 - 25)
    expect(hits[1].km).toBeLessThanOrEqual(3 * 111.2 + 25)
    expect(hits[1].country).toBe('Barbados')
  })
  it('does not re-announce A after an ocean gap; emits B after a gap', () => {
    expect(countryEntries(route, km, bands([[2, 'AA'], [4, null], [6, 'AA'], [10, null]])).map((h) => h.cc)).toEqual(['AA'])
    expect(countryEntries(route, km, bands([[2, 'AA'], [4, null], [10, 'BB']])).map((h) => h.cc)).toEqual(['AA', 'BB'])
  })
  it('starts with the country at km 0', () => {
    expect(countryEntries(route, km, () => 'FR')).toEqual([{ cc: 'FR', country: 'France', km: 0 }])
  })
  it('is empty for no route or zero length', () => {
    expect(countryEntries([], 100, () => 'FR')).toEqual([])
    expect(countryEntries(route, 0, () => 'FR')).toEqual([])
  })
})

const hits: CountryHit[] = [
  { cc: 'AA', country: 'A', km: 0 },
  { cc: 'BB', country: 'B', km: 100 },
  { cc: 'CC', country: 'C', km: 200 },
  { cc: 'BB', country: 'B', km: 300 },
]
describe('enteredBetween / coveredBetween', () => {
  it('excludes the start country and honours fromKm < km <= toKm', () => {
    expect(enteredBetween(hits, 0, 100).map((h) => h.cc)).toEqual(['BB'])
    expect(enteredBetween(hits, 100, 200).map((h) => h.cc)).toEqual(['CC'])
    expect(enteredBetween(hits, 0, 99)).toEqual([])
  })
  it('dedups by cc keeping the first', () => {
    const r = enteredBetween(hits, 50, 400)
    expect(r.map((h) => [h.cc, h.km])).toEqual([['BB', 100], ['CC', 200]])
  })
  it('covered includes the country in force at fromKm', () => {
    expect(coveredBetween(hits, 150, 250).map((h) => h.cc)).toEqual(['BB', 'CC'])
    expect(coveredBetween(hits, 0, 50).map((h) => h.cc)).toEqual(['AA'])
    expect(coveredBetween(hits, 250, 350).map((h) => h.cc)).toEqual(['CC', 'BB'])
  })
})

describe('loadCountryAt', () => {
  it('names land from bundled data and returns null mid-ocean', async () => {
    const at = await loadCountryAt()
    expect(at(48.85, 2.35)).toBe('FR')
    expect(at(35.68, 139.69)).toBe('JP')
    expect(at(30, -40)).toBeNull()
  })
})
