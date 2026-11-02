import { describe, expect, it } from 'vitest'
import { checkpointBody, planCheckpointAlerts } from '../src/lib/checkpointPlan'

const base = { startMs: 1_000_000, startKm: 0, nowMs: 1_000_000, places: ['A', 'B', 'C'] }

describe('planCheckpointAlerts', () => {
  it('plan_skips_stops_already_passed', () => {
    const p = planCheckpointAlerts({ ...base, stopKms: [100, 200, 300], nowMs: 1_000_000 + 90_000 })
    expect(p.map((a) => a.place)).toEqual(['B', 'C'])
  })
  it('skips stops at or behind the start km', () => {
    const p = planCheckpointAlerts({ ...base, startKm: 100, stopKms: [100, 200, 300] })
    expect(p.map((a) => a.place)).toEqual(['B', 'C'])
  })
  it('plan_times_follow_the_100_km_per_minute_clock', () => {
    const p = planCheckpointAlerts({ ...base, stopKms: [100, 250, 300] })
    expect(p.map((a) => a.atMs)).toEqual([1_060_000, 1_150_000, 1_180_000])
  })
  it('honours a custom kmPerMin', () => {
    expect(planCheckpointAlerts({ ...base, stopKms: [100], places: ['A'], kmPerMin: 50 })[0].atMs).toBe(1_120_000)
  })
  it('plan_ids_are_unique_and_stable_for_same_input', () => {
    const o = { ...base, stopKms: [100, 200, 300] }
    const a = planCheckpointAlerts(o)
    const b = planCheckpointAlerts(o)
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id))
    expect(new Set(a.map((x) => x.id)).size).toBe(3)
    for (const x of a) expect(Number.isInteger(x.id) && x.id > 0 && x.id <= 2147483647).toBe(true)
  })
  it('plan_empty_when_no_future_stops', () => {
    expect(planCheckpointAlerts({ ...base, stopKms: [] })).toEqual([])
    expect(planCheckpointAlerts({ ...base, stopKms: [100], nowMs: 2_000_000 })).toEqual([])
  })
  it('falls back to a generic place when a name is missing', () => {
    const p = planCheckpointAlerts({ ...base, stopKms: [100], places: [] })
    expect(p[0].place).not.toBe('')
  })
  it('body names the place', () => {
    expect(checkpointBody('Lisbon')).toContain('Lisbon')
  })
})
