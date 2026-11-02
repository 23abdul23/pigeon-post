import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFlightHost, type FlightHostApi } from '../src/lib/flightHost'
import type { FlightNative } from '../src/lib/flightPlugin'

const meta = { title: 'Pip is flying to Rome', artist: 'Next stop in about 5 min' }

const fakeNative = (over: Partial<FlightNative> = {}) => {
  const n = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    onScreenOff: vi.fn(() => () => {}),
    onScreenOn: vi.fn(() => () => {}),
    onEndRequested: vi.fn(() => () => {}),
    ...over,
  }
  return n satisfies FlightNative
}

const fakeWeb = () =>
  ({
    ensureKeepAlive: vi.fn().mockResolvedValue(true),
    releaseKeepAlive: vi.fn(),
    isKeepAliveActive: vi.fn().mockReturnValue(true),
    setKeepAliveMeta: vi.fn(),
    setKeepAlivePosition: vi.fn(),
  }) satisfies FlightHostApi

describe('flight host', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('web_host_delegates_every_call_to_keepAlive', async () => {
    const web = fakeWeb()
    const h = createFlightHost(null, web)
    expect(await h.ensureKeepAlive(meta)).toBe(true)
    h.releaseKeepAlive(500)
    expect(h.isKeepAliveActive()).toBe(true)
    h.setKeepAliveMeta(meta)
    h.setKeepAlivePosition(60, 10)
    expect(web.ensureKeepAlive).toHaveBeenCalledWith(meta)
    expect(web.releaseKeepAlive).toHaveBeenCalledWith(500)
    expect(web.setKeepAliveMeta).toHaveBeenCalledWith(meta)
    expect(web.setKeepAlivePosition).toHaveBeenCalledWith(60, 10)
  })

  it('native_ensure_starts_the_service_once_for_repeated_calls', async () => {
    const n = fakeNative()
    const h = createFlightHost(n, fakeWeb())
    await Promise.all([h.ensureKeepAlive(meta), h.ensureKeepAlive(meta)])
    await h.ensureKeepAlive(meta)
    expect(n.start).toHaveBeenCalledTimes(1)
    expect(n.start.mock.calls[0][0]).toMatchObject({ title: meta.title, text: meta.artist })
  })

  it('native_ensure_resolves_true_when_service_started', async () => {
    const h = createFlightHost(fakeNative(), fakeWeb())
    expect(await h.ensureKeepAlive(meta)).toBe(true)
  })

  it('native_ensure_resolves_false_when_start_rejects', async () => {
    const n = fakeNative({ start: vi.fn().mockRejectedValue(new Error('denied')) })
    const h = createFlightHost(n, fakeWeb())
    expect(await h.ensureKeepAlive(meta)).toBe(false)
    expect(h.isKeepAliveActive()).toBe(false)
  })

  it('native_release_stops_service_after_grace_unless_ensure_comes_first', async () => {
    const n = fakeNative()
    const h = createFlightHost(n, fakeWeb())
    await h.ensureKeepAlive(meta)
    h.releaseKeepAlive(2000)
    await vi.advanceTimersByTimeAsync(1000)
    await h.ensureKeepAlive(meta) // the chained slot
    await vi.advanceTimersByTimeAsync(5000)
    expect(n.stop).not.toHaveBeenCalled()
    expect(h.isKeepAliveActive()).toBe(true)
    h.releaseKeepAlive(2000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(n.stop).toHaveBeenCalledTimes(1)
    expect(h.isKeepAliveActive()).toBe(false)
  })

  it('native_isActive_reflects_started_state', async () => {
    const h = createFlightHost(fakeNative(), fakeWeb())
    expect(h.isKeepAliveActive()).toBe(false)
    await h.ensureKeepAlive(meta)
    expect(h.isKeepAliveActive()).toBe(true)
  })

  it('native_position_and_meta_updates_refresh_the_running_service_only', async () => {
    vi.setSystemTime(1_000_000)
    const n = fakeNative()
    const h = createFlightHost(n, fakeWeb())
    h.setKeepAlivePosition(60, 10) // not running: nothing to update
    h.setKeepAliveMeta(meta)
    expect(n.start).not.toHaveBeenCalled()
    await h.ensureKeepAlive(meta)
    h.setKeepAlivePosition(60, 10)
    expect(n.start).toHaveBeenLastCalledWith({ title: meta.title, text: meta.artist, endsAtMs: 1_000_000 + 50_000 })
    h.setKeepAliveMeta({ title: 'New card: Paris' })
    expect(n.start).toHaveBeenLastCalledWith({ title: 'New card: Paris', text: '', endsAtMs: 1_000_000 + 50_000 })
  })

  it('first_start_carries_endsAtMs_zero_before_a_position_is_known', async () => {
    vi.setSystemTime(5_000_000)
    const n = fakeNative()
    const h = createFlightHost(n, fakeWeb())
    await h.ensureKeepAlive(meta)
    expect(n.start).toHaveBeenCalledWith({ title: meta.title, text: meta.artist, endsAtMs: 0 })
  })

  it('second_flight_after_stop_does_not_inherit_the_previous_endsAtMs', async () => {
    vi.setSystemTime(1_000_000)
    const n = fakeNative()
    const h = createFlightHost(n, fakeWeb())
    await h.ensureKeepAlive(meta)
    h.setKeepAlivePosition(60, 10)
    h.releaseKeepAlive(100)
    await vi.advanceTimersByTimeAsync(100)
    await h.ensureKeepAlive(meta)
    expect(n.start).toHaveBeenLastCalledWith({ title: meta.title, text: meta.artist, endsAtMs: 0 })
  })

  it('release_during_pending_start_does_not_leave_service_running', async () => {
    let resolveStart!: () => void
    const n = fakeNative({ start: vi.fn(() => new Promise<void>((r) => (resolveStart = r))) })
    const h = createFlightHost(n, fakeWeb())
    const p = h.ensureKeepAlive(meta)
    h.releaseKeepAlive(100)
    await vi.advanceTimersByTimeAsync(100)
    resolveStart()
    await p
    expect(h.isKeepAliveActive()).toBe(false)
    expect(n.stop).toHaveBeenCalled()
    expect(n.stop.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
})
