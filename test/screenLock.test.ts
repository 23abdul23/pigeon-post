import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdWakeLock } from '../src/lib/wakeLock'
import { idlePermission, markIdleAsked, requestIdlePermission, shouldAskIdlePermission, startScreenWatch } from '../src/lib/idle'

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('holdWakeLock', () => {
  function fake(opts: { fail?: boolean } = {}) {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }) as unknown as Document
    const sentinels: { released: boolean; fireRelease(): void }[] = []
    const nav = {
      wakeLock: {
        request: vi.fn(async () => {
          if (opts.fail) throw new Error('NotAllowedError')
          const l = new EventTarget()
          const s = { released: false, release: async () => void (s.released = true), addEventListener: (t: string, cb: () => void) => l.addEventListener(t, cb), fireRelease: () => l.dispatchEvent(new Event('release')) }
          sentinels.push(s)
          return s
        }),
      },
    } as unknown as Navigator
    const setVisibility = (v: string) => {
      ;(doc as unknown as { visibilityState: string }).visibilityState = v
      doc.dispatchEvent(new Event('visibilitychange'))
    }
    return { doc, nav, sentinels, setVisibility }
  }

  it('takes the lock while visible and lets go on stop', async () => {
    const f = fake()
    const stop = holdWakeLock(f.nav, f.doc)
    await flush()
    expect(f.sentinels.length).toBe(1)
    stop()
    await flush()
    expect(f.sentinels[0].released).toBe(true)
  })

  it('asks again when the page comes back after the browser released it', async () => {
    const f = fake()
    holdWakeLock(f.nav, f.doc)
    await flush()
    f.setVisibility('hidden')
    f.sentinels[0].fireRelease() // the browser drops the lock when the page is hidden
    f.setVisibility('visible')
    await flush()
    expect(f.sentinels.length).toBe(2)
  })

  it('does not ask while hidden, and never asks twice for one live lock', async () => {
    const f = fake()
    f.setVisibility('hidden')
    holdWakeLock(f.nav, f.doc)
    await flush()
    expect(f.sentinels.length).toBe(0)
    f.setVisibility('visible')
    f.setVisibility('visible')
    await flush()
    expect(f.sentinels.length).toBe(1)
  })

  it('releases a lock that arrives after stop()', async () => {
    const f = fake()
    const stop = holdWakeLock(f.nav, f.doc)
    stop() // before the request resolved
    await flush()
    expect(f.sentinels.every((s) => s.released)).toBe(true)
  })

  it('never throws: unsupported browser, or a refused request that is retried on the next return', async () => {
    const f = fake({ fail: true })
    expect(() => holdWakeLock({} as Navigator, f.doc)).not.toThrow()
    holdWakeLock(f.nav, f.doc)
    await flush()
    f.setVisibility('visible')
    await flush()
    expect((f.nav as unknown as { wakeLock: { request: ReturnType<typeof vi.fn> } }).wakeLock.request.mock.calls.length).toBe(2)
  })
})

describe('idle detection helpers', () => {
  let store: Record<string, string>
  const stubBrowser = (opts: { supported?: boolean; permission?: 'granted' | 'denied' | 'prompt' | 'throws'; detector?: boolean }) => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) })
    vi.stubGlobal('navigator', {
      permissions: {
        query: async () => {
          if (opts.permission === 'throws') throw new TypeError('unknown permission')
          return { state: opts.permission ?? 'prompt' }
        },
      },
    })
    if (opts.supported === false) {
      vi.stubGlobal('IdleDetector', undefined)
      return
    }
    class Detector extends EventTarget {
      static instance: Detector
      screenState: 'locked' | 'unlocked' | null = null
      started: AbortSignal | undefined
      static requestPermission = vi.fn(async () => 'granted' as const)
      constructor() {
        super()
        Detector.instance = this
      }
      async start(o: { threshold: number; signal?: AbortSignal }) {
        this.started = o.signal
        this.screenState = 'unlocked'
      }
      set(s: 'locked' | 'unlocked') {
        this.screenState = s
        this.dispatchEvent(new Event('change'))
      }
    }
    vi.stubGlobal('IdleDetector', Detector)
    return Detector
  }
  beforeEach(() => (store = {}))
  afterEach(() => vi.unstubAllGlobals())

  it('reports the permission state, and unsupported browsers', async () => {
    stubBrowser({ permission: 'granted' })
    expect(await idlePermission()).toBe('granted')
    stubBrowser({ permission: 'denied' })
    expect(await idlePermission()).toBe('denied')
    stubBrowser({ permission: 'throws' })
    expect(await idlePermission()).toBe('prompt')
    stubBrowser({ supported: false })
    expect(await idlePermission()).toBe('unsupported')
  })

  it('asks once, then again only after a week, and never when it would not help', async () => {
    stubBrowser({ permission: 'prompt' })
    const t0 = Date.UTC(2026, 9, 24)
    expect(await shouldAskIdlePermission(t0)).toBe(true)
    markIdleAsked(t0)
    expect(await shouldAskIdlePermission(t0 + 3 * 24 * 3600 * 1000)).toBe(false)
    expect(await shouldAskIdlePermission(t0 + 8 * 24 * 3600 * 1000)).toBe(true)
    stubBrowser({ permission: 'granted' })
    expect(await shouldAskIdlePermission(t0 + 30 * 24 * 3600 * 1000)).toBe(false)
    stubBrowser({ permission: 'denied' })
    expect(await shouldAskIdlePermission(t0 + 30 * 24 * 3600 * 1000)).toBe(false)
    stubBrowser({ supported: false })
    expect(await shouldAskIdlePermission(t0 + 30 * 24 * 3600 * 1000)).toBe(false)
  })

  it('requestIdlePermission is true only when Chrome grants it', async () => {
    const D = stubBrowser({ permission: 'prompt' })!
    expect(await requestIdlePermission()).toBe(true)
    D.requestPermission.mockResolvedValueOnce('denied' as never)
    expect(await requestIdlePermission()).toBe(false)
    D.requestPermission.mockRejectedValueOnce(new Error('needs a user gesture'))
    expect(await requestIdlePermission()).toBe(false)
  })

  it('screen watch: unknown without the permission, live state and change events with it, silent after stop', async () => {
    stubBrowser({ permission: 'prompt' })
    const none = startScreenWatch()
    await flush()
    expect(none.screen()).toBe('unknown')

    const D = stubBrowser({ permission: 'granted' })!
    const seen: string[] = []
    const w = startScreenWatch()
    w.subscribe((s) => seen.push(s))
    await flush()
    expect(w.screen()).toBe('unlocked')
    D.instance.set('locked')
    D.instance.set('unlocked')
    expect(seen).toEqual(['unlocked', 'locked', 'unlocked'])
    w.stop()
    expect(D.instance.started?.aborted).toBe(true)
    D.instance.set('locked')
    expect(seen.length).toBe(3)
  })
})
