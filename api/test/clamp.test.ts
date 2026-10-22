import { describe, expect, it } from 'vitest'
import { clampKm } from '../src/lib/clamp'

describe('clampKm', () => {
  it('clampKm_limits_inflated_claims', () => {
    // a 10 h claim (60 000 km) for a 5 min session: 5 * 100 * 1.05
    expect(clampKm(600 * 100, 0, 5 * 60000)).toBeCloseTo(525)
    expect(clampKm(300, 0, 5 * 60000)).toBe(300) // honest claims pass through
  })
  it('clampKm_never_negative', () => {
    expect(clampKm(100, 60000, 0)).toBe(0) // end before start
    expect(clampKm(-50, 0, 60000)).toBe(0)
  })
})
