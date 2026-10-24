import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isKeepAliveActive, makeQuietWav, releaseKeepAlive, startKeepAlive, stopKeepAlive } from '../src/lib/keepAlive'

describe('makeQuietWav', () => {
  it('writes a mono 16-bit PCM WAV with quiet, non-silent samples', () => {
    const w = makeQuietWav(2, 8000, 0.00126)
    const v = new DataView(w.buffer)
    const str = (o: number, n: number) => String.fromCharCode(...w.slice(o, o + n))
    expect([str(0, 4), str(8, 4), str(12, 4), str(36, 4)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect(v.getUint16(20, true)).toBe(1)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(8000)
    expect(w.byteLength).toBe(44 + 2 * 16000)
    expect(v.getUint32(40, true)).toBe(2 * 16000)
    expect(v.getUint32(4, true)).toBe(w.byteLength - 8)
    let max = 0
    for (let i = 0; i < 16000; i++) max = Math.max(max, Math.abs(v.getInt16(44 + 2 * i, true)))
    expect(max).toBeGreaterThan(0)
    expect(max).toBeLessThanOrEqual(0.00126 * 32767)
  })
})

describe('keep-alive element', () => {
  const handlers: Record<string, unknown> = {}
  let play: ReturnType<typeof vi.fn>
  let pause: ReturnType<typeof vi.fn>
  const setup = (withSession = true) => {
    play = vi.fn().mockResolvedValue(undefined)
    pause = vi.fn()
    vi.stubGlobal('Audio', function () {
      return { play: () => play(), pause: () => pause(), addEventListener: vi.fn() } // the element is cached across tests, so delegate
    })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x' })
    vi.stubGlobal('MediaMetadata', function (this: object, m: object) { Object.assign(this, m) })
    vi.stubGlobal('navigator', withSession ? { mediaSession: { metadata: null, playbackState: 'none', setActionHandler: (a: string, h: unknown) => (handlers[a] = h), setPositionState: vi.fn() } } : {})
  }
  beforeEach(() => stopKeepAlive())
  afterEach(() => vi.unstubAllGlobals())

  it('resolves true when playing, and stop pauses and clears handlers', async () => {
    setup()
    expect(await startKeepAlive({ title: 'T' })).toBe(true)
    expect(isKeepAliveActive()).toBe(true)
    expect(typeof handlers.play).toBe('function')
    stopKeepAlive()
    expect(pause).toHaveBeenCalled()
    expect(handlers.play).toBeNull()
    expect(handlers.pause).toBeNull()
    expect(isKeepAliveActive()).toBe(false)
  })

  it('a delayed release is cancelled by a start in between (chained slot handoff)', async () => {
    setup()
    vi.useFakeTimers()
    await startKeepAlive({ title: 'T' })
    releaseKeepAlive(2000)
    vi.advanceTimersByTime(500)
    await startKeepAlive({ title: 'T2' })
    vi.advanceTimersByTime(5000)
    expect(pause).not.toHaveBeenCalled()
    releaseKeepAlive(2000)
    vi.advanceTimersByTime(2000)
    expect(pause).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('resolves false when autoplay is blocked', async () => {
    setup()
    play.mockRejectedValue(new Error('NotAllowed'))
    expect(await startKeepAlive({ title: 'T' })).toBe(false)
    expect(isKeepAliveActive()).toBe(false)
  })

  it('works without mediaSession', async () => {
    setup(false)
    expect(await startKeepAlive({ title: 'T' })).toBe(true)
    expect(() => stopKeepAlive()).not.toThrow()
  })
})
