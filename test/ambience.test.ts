import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })

const n = { ctx: 0, osc: 0, src: 0 }
const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() })
const node = (extra: object = {}) => ({ connect: (x: unknown) => x, start: vi.fn(), stop: vi.fn(), ...extra })
class FakeAudioContext {
  currentTime = 0
  sampleRate = 100
  destination = {}
  constructor() {
    n.ctx++
  }
  resume = vi.fn()
  createBuffer = (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) })
  createOscillator = () => (n.osc++, node({ frequency: param() }))
  createGain = () => node({ gain: param() })
  createBufferSource = () => (n.src++, node())
  createBiquadFilter = () => node({ frequency: param() })
}

async function load(patch: { soundOn: boolean; ambience: boolean }) {
  vi.resetModules()
  const { getState, setState } = await import('../src/lib/store')
  setState({ soundOn: patch.soundOn, settings: { ...getState().settings, ambience: patch.ambience } })
  return (await import('../src/lib/sound')).startAmbience
}

describe('startAmbience', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    n.ctx = n.osc = n.src = 0
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('document', { addEventListener: vi.fn(), hidden: false })
  })
  afterEach(() => vi.useRealTimers())

  it('silent_when_muted', async () => {
    const stop = (await load({ soundOn: false, ambience: true }))()
    expect(n.ctx).toBe(0)
    expect(() => stop()).not.toThrow()
  })

  it('silent_when_ambience_off', async () => {
    const stop = (await load({ soundOn: true, ambience: false }))()
    expect(n.ctx).toBe(0)
    expect(() => stop()).not.toThrow()
  })

  it('chirps_while_running_and_stops_after_stop', async () => {
    const stop = (await load({ soundOn: true, ambience: true }))()
    expect(n.src).toBe(1)
    vi.advanceTimersByTime(6000)
    expect(n.osc).toBeGreaterThan(0)
    stop()
    const after = n.osc
    vi.advanceTimersByTime(20000)
    expect(n.osc).toBe(after)
  })
})
