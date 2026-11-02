import { describe, expect, it, vi } from 'vitest'
import { nativeScreenSource, type ScreenEvents } from '../src/lib/nativeScreen'

// A fake native plugin: handler sets the test fires by hand, with unsubscribe spies.
function fakeEvents() {
  const off = new Set<() => void>()
  const on = new Set<() => void>()
  const unsubOff = vi.fn()
  const unsubOn = vi.fn()
  const ev: ScreenEvents = {
    onScreenOff: (cb) => (off.add(cb), () => (unsubOff(), off.delete(cb))),
    onScreenOn: (cb) => (on.add(cb), () => (unsubOn(), on.delete(cb))),
  }
  return { ev, fireOff: () => off.forEach((f) => f()), fireOn: () => on.forEach((f) => f()), unsubOff, unsubOn, off, on }
}

describe('nativeScreenSource', () => {
  it('starts_unlocked', () => {
    const src = nativeScreenSource(fakeEvents().ev)
    expect(src.screen()).toBe('unlocked')
  })

  it('screen_off_event_reports_locked_to_subscribers', () => {
    const f = fakeEvents()
    const src = nativeScreenSource(f.ev)
    const seen: string[] = []
    src.onScreen((s) => seen.push(s))
    f.fireOff()
    expect(seen).toEqual(['locked'])
    expect(src.screen()).toBe('locked')
  })

  it('screen_on_event_reports_unlocked', () => {
    const f = fakeEvents()
    const src = nativeScreenSource(f.ev)
    const seen: string[] = []
    src.onScreen((s) => seen.push(s))
    f.fireOff()
    f.fireOn()
    expect(seen).toEqual(['locked', 'unlocked'])
    expect(src.screen()).toBe('unlocked')
  })

  it('unsubscribe_stops_callbacks', () => {
    const f = fakeEvents()
    const src = nativeScreenSource(f.ev)
    const seen: string[] = []
    const unsub = src.onScreen((s) => seen.push(s))
    f.fireOff()
    unsub()
    f.fireOn()
    expect(seen).toEqual(['locked'])
    expect(src.screen()).toBe('unlocked') // state still follows events
  })

  it('stop_unsubscribes_from_native_events', () => {
    const f = fakeEvents()
    const src = nativeScreenSource(f.ev)
    const seen: string[] = []
    src.onScreen((s) => seen.push(s))
    src.stop()
    expect(f.unsubOff).toHaveBeenCalledTimes(1)
    expect(f.unsubOn).toHaveBeenCalledTimes(1)
    expect(f.off.size).toBe(0)
    expect(f.on.size).toBe(0)
    f.fireOff()
    expect(seen).toEqual([])
  })
})
