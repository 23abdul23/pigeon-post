import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/auth', () => ({ getIdToken: vi.fn().mockResolvedValue('tok') }))

// a fetch that only ever settles by aborting, with the signal's reason (what modern browsers do)
const hangingFetch = () => vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason))))

async function load() {
  vi.stubEnv('VITE_API_URL', 'https://api.test')
  vi.resetModules()
  return import('../src/lib/api')
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('api', () => {
  it('api_with_caller_signal_still_propagates_abort', async () => {
    const { api, isAbortError } = await load()
    const fetchMock = hangingFetch()
    vi.stubGlobal('fetch', fetchMock)
    const c = new AbortController()
    const p = api('/places/search?q=Pa', { signal: c.signal })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    c.abort()
    const err = await p.catch((e) => e)
    expect(isAbortError(err)).toBe(true) // the caller's abort, not turned into a timeout
    expect(isAbortError(new Error('x'))).toBe(false)
  })

  it('api_times_out_after_15s_and_is_retryable', async () => {
    vi.useFakeTimers()
    const { api, ApiError, ApiTimeout, isAbortError } = await load()
    vi.stubGlobal('fetch', hangingFetch())
    const p = api('/state').catch((e) => e)
    await vi.advanceTimersByTimeAsync(14_999)
    let settled = false
    void p.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const err = await p
    expect(err).toBeInstanceOf(ApiTimeout)
    expect(err).not.toBeInstanceOf(ApiError) // the outbox retries anything that is not an ApiError
    expect(isAbortError(err)).toBe(false)
    // a caller signal still gets the timeout too, and a longer one can be asked for
    const c = new AbortController()
    const q = api('/x', { signal: c.signal }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await q).toBeInstanceOf(ApiTimeout)
    const r = api('/import', { method: 'POST' }, 30_000).catch((e) => e)
    await vi.advanceTimersByTimeAsync(15_000)
    let early = false
    void r.then(() => (early = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(early).toBe(false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await r).toBeInstanceOf(ApiTimeout)
    expect(vi.getTimerCount()).toBe(0) // timers cleared
  })
})
