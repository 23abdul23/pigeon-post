import { describe, expect, it } from 'vitest'
import { routeLengthKm, type Pt } from '../src/lib/geo'
import { planRoute } from '../src/lib/trips'

const finite = (r: Pt[]) => r.length >= 2 && r.every(([la, ln]) => Number.isFinite(la) && Number.isFinite(ln))
// a world-wrap jump draws a line across the whole map; beyond Mercator's 85 deg nothing is drawn, and a path through the pole
// legitimately swaps meridians there, so only pairs the map can show are checked (plus no long hop anywhere)
const maxLngJump = (r: Pt[]) => Math.max(0, ...r.slice(1).flatMap((p, i) => (Math.abs(p[0]) < 85 && Math.abs(r[i][0]) < 85 ? [Math.abs(p[1] - r[i][1])] : [])))
const maxStepKm = (r: Pt[]) => Math.max(...r.slice(1).map((p, i) => routeLengthKm([r[i], p])))

describe('planRoute for any coordinate', () => {
  it('plan_route_across_antimeridian_has_finite_points_and_no_world_wrap', () => {
    const pairs: [Pt, Pt][] = [
      [[35.68, 139.69], [21.31, -157.86]], // Tokyo -> Honolulu
      [[-18.14, 178.44], [-13.83, -171.76]], // Suva -> Apia
      [[-13.83, -171.76], [-18.14, 178.44]], // and back
      [[65.0, 179.6], [65.1, -179.6]], // a short hop over the line (great-circle path)
      [[-16.5, 179.9], [-16.5, -179.9]],
    ]
    for (const [a, b] of pairs) {
      const r = planRoute(a, b)
      expect(finite(r)).toBe(true)
      expect(maxLngJump(r)).toBeLessThan(90)
      expect(Number.isFinite(routeLengthKm(r))).toBe(true)
      expect(r[0][0]).toBeCloseTo(a[0], 4)
      expect(r[r.length - 1][0]).toBeCloseTo(b[0], 4)
    }
  })

  it('plan_route_to_open_ocean_destination_completes_under_200ms', () => {
    const cases: [Pt, Pt][] = [
      [[51.51, -0.13], [-48.88, -123.39]], // London -> Point Nemo
      [[17.38, 78.46], [-60, -150]],
      [[-33.87, 151.21], [0, -30]],
    ]
    planRoute(cases[0][0], cases[0][1]) // warm up the JIT and the land mask import
    for (const [a, b] of cases) {
      const t0 = performance.now()
      const r = planRoute(a, b)
      expect(performance.now() - t0).toBeLessThan(200)
      expect(finite(r)).toBe(true)
      expect(maxLngJump(r)).toBeLessThan(90)
    }
  })

  it('plan_route_to_pole_has_finite_points', () => {
    const cases: [Pt, Pt][] = [
      [[51.51, -0.13], [90, 0]],
      [[51.51, -0.13], [-90, 180]],
      [[89.99, 10], [89.99, -170]], // over the pole, a short hop
      [[-90, -180], [90, 180]], // antipodal
      [[0, 0], [0, 180]], // antipodal on the equator
      [[10, 20], [10, 20]], // identical
      [[10, 20], [10.0001, 20.0001]], // near-identical
      [[-90, 0], [-90, 90]], // same pole, different longitude
    ]
    for (const [a, b] of cases) {
      const r = planRoute(a, b)
      expect(finite(r), `${a} -> ${b}`).toBe(true)
      expect(maxLngJump(r), `${a} -> ${b}`).toBeLessThan(90)
      expect(maxStepKm(r), `${a} -> ${b}`).toBeLessThan(500)
      expect(Number.isFinite(routeLengthKm(r))).toBe(true)
    }
  })
})
