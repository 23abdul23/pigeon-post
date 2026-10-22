import { describe, expect, it, vi } from 'vitest'
import mask from '../src/data/landmask.json'
import { serverNow } from '../src/lib/device'
import { computeProgress, flightIds } from '../src/lib/flight'
import { landRoute } from '../src/lib/landRoute'
import { KM_PER_FOCUS_MINUTE, greatCircle, haversineKm, pointAtKm, routeLengthKm, type Pt } from '../src/lib/geo'
import { setState, type ActiveSession, type Trip } from '../src/lib/store'

const HYD: Pt = [17.38, 78.46]
const LIS: Pt = [38.72, -9.14]

const route = greatCircle(HYD, LIS, 50)
const trip = { id: 't', routeKm: routeLengthKm(route), route } as Trip

const session = (over: Partial<ActiveSession> = {}): ActiveSession => ({ tripId: 't', startMs: 0, durationMin: 25, baseKm: 0, ...over })

describe('geo', () => {
  it('great circle starts and ends at the given points', () => {
    expect(route[0][0]).toBeCloseTo(HYD[0], 4)
    expect(route[route.length - 1][1]).toBeCloseTo(LIS[1], 4)
  })

  it('route length matches the haversine distance', () => {
    const direct = haversineKm({ lat: HYD[0], lng: HYD[1] }, { lat: LIS[0], lng: LIS[1] })
    expect(trip.routeKm).toBeGreaterThan(direct * 0.999)
    expect(trip.routeKm).toBeLessThan(direct * 1.01)
  })

  it('pointAtKm clamps to both ends', () => {
    expect(pointAtKm(route, -50).pt[0]).toBeCloseTo(HYD[0], 4)
    expect(pointAtKm(route, 1e9).pt[0]).toBeCloseTo(LIS[0], 4)
  })

  it('pointAtKm moves monotonically away from the start', () => {
    const d = [0, 500, 1500, 4000].map((km) => haversineKm({ lat: HYD[0], lng: HYD[1] }, { lat: pointAtKm(route, km).pt[0], lng: pointAtKm(route, km).pt[1] }))
    expect(d).toEqual([...d].sort((a, b) => a - b))
  })
})

describe('computeProgress', () => {
  it('is clock based: 10 minutes is 1000 km', () => {
    const p = computeProgress(session(), trip, 10 * 60000)
    expect(p.km).toBeCloseTo(10 * KM_PER_FOCUS_MINUTE, 3)
    expect(p.done).toBe(false)
  })

  it('freezes at the moment the tab was left', () => {
    const p = computeProgress(session({ leftAtMs: 5 * 60000 }), trip, 20 * 60000)
    expect(p.km).toBeCloseTo(500, 3)
  })

  it('finishes when the timer runs out and never exceeds the session length', () => {
    const p = computeProgress(session(), trip, 90 * 60000)
    expect(p.done).toBe(true)
    expect(p.km).toBeCloseTo(25 * KM_PER_FOCUS_MINUTE, 3)
    expect(p.remainingMs).toBe(0)
  })

  it('resumes from the distance already covered', () => {
    const p = computeProgress(session({ baseKm: 1200 }), trip, 5 * 60000)
    expect(p.km).toBeCloseTo(1700, 3)
  })

  it('stops at the destination and reports arrival', () => {
    const p = computeProgress(session({ baseKm: trip.routeKm - 100, durationMin: 60 }), trip, 30 * 60000)
    expect(p.km).toBeCloseTo(trip.routeKm, 3)
    expect(p.arrived).toBe(true)
  })
})

describe('server clock and flight ids', () => {
  it('progress_uses_server_clock_offset', () => {
    const T = 1_800_000_000_000
    vi.useFakeTimers({ now: T + 5 * 60000 }) // this device's clock runs 5 minutes ahead
    setState({ clockOffsetMs: -5 * 60000 }) // as measured from GET /state's serverTime
    const s = session({ startMs: T - 10 * 60000 })
    expect(computeProgress(s, trip, serverNow()).km).toBeCloseTo(computeProgress(s, trip, T).km, 6)
    expect(computeProgress(s, trip, serverNow()).km).toBeCloseTo(1000, 3)
    vi.useRealTimers()
  })

  it('session_id_is_deterministic_per_flight_and_valid', () => {
    const a = flightIds({ tripId: 't', startMs: 1234 })
    expect(flightIds({ tripId: 't', startMs: 1234 })).toEqual(a) // the same on every device and run
    expect(flightIds({ tripId: 't', startMs: 1235 }).sessionId).not.toBe(a.sessionId)
    expect(a.storyId).not.toBe(a.sessionId)
    for (const v of [a.sessionId, a.storyId]) {
      expect(v).toMatch(/^[\w-]{1,64}$/) // the server's id() rule
      expect(v).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    }
  })
})

describe('landRoute', () => {
  const cell = (lat: number, lng: number) => (mask as string[])[Math.floor(90 - lat)][Math.floor(lng + 180)] === '1'
  const share = (r: Pt[]) => r.filter(([la, ln]) => cell(la, ((((ln + 180) % 360) + 360) % 360) - 180)).length / r.length

  it('starts and ends at the requested points', () => {
    const r = landRoute(HYD, LIS)
    expect(r[0]).toEqual(HYD)
    expect(r[r.length - 1][0]).toBeCloseTo(LIS[0], 4)
  })

  it('stays mostly over land between two cities on one landmass', () => {
    expect(share(landRoute(HYD, LIS))).toBeGreaterThan(0.85)
  })

  it('is longer than the great circle but not absurdly so', () => {
    const r = landRoute(HYD, LIS)
    expect(routeLengthKm(r)).toBeGreaterThan(trip.routeKm)
    expect(routeLengthKm(r)).toBeLessThan(trip.routeKm * 1.6)
  })

  it('still reaches a destination across an ocean', () => {
    const r = landRoute(HYD, [37.77, -122.42])
    expect(r[r.length - 1][0]).toBeCloseTo(37.77, 4)
  })
})
