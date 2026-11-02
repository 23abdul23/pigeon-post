import { describe, expect, it, vi } from 'vitest'
import { createFlightNative } from '../src/lib/flightPlugin'

const fakeRaw = () => {
  const remove = vi.fn().mockResolvedValue(undefined)
  let resolve!: (h: { remove: typeof remove }) => void
  const raw = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn(() => new Promise<{ remove: typeof remove }>((r) => (resolve = r))),
  }
  return { raw, remove, resolve: () => resolve({ remove }) }
}

describe('createFlightNative', () => {
  it('adapter_unsubscribe_removes_the_handle_after_it_resolves', async () => {
    const f = fakeRaw()
    const off = createFlightNative(f.raw).onScreenOff(() => {})
    f.resolve()
    await Promise.resolve()
    await Promise.resolve()
    off()
    await Promise.resolve()
    expect(f.remove).toHaveBeenCalledTimes(1)
  })

  it('adapter_unsubscribe_before_resolve_still_removes_the_handle', async () => {
    const f = fakeRaw()
    const off = createFlightNative(f.raw).onEndRequested(() => {})
    off()
    expect(f.remove).not.toHaveBeenCalled()
    f.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(f.remove).toHaveBeenCalledTimes(1)
  })

  it('adapter_forwards_each_event_name_to_addListener', () => {
    const f = fakeRaw()
    const n = createFlightNative(f.raw)
    const cb = () => {}
    n.onScreenOff(cb)
    n.onScreenOn(cb)
    n.onEndRequested(cb)
    expect(f.raw.addListener.mock.calls).toEqual([['screenOff', cb], ['screenOn', cb], ['endRequested', cb]])
  })

  it('adapter_start_and_stop_pass_through', async () => {
    const f = fakeRaw()
    const n = createFlightNative(f.raw)
    const o = { title: 't', text: 'x', endsAtMs: 5 }
    await n.start(o)
    await n.stop()
    expect(f.raw.start).toHaveBeenCalledWith(o)
    expect(f.raw.stop).toHaveBeenCalledTimes(1)
  })
})
