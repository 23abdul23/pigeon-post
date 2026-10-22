import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/auth', () => ({ getIdToken: vi.fn().mockResolvedValue('tok') }))

describe('api', () => {
  it('api_passes_the_abort_signal_and_rejects_with_an_abort_error', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.test')
    vi.resetModules()
    const { api, isAbortError } = await import('../src/lib/api')
    const fetchMock = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason))))
    vi.stubGlobal('fetch', fetchMock)
    const c = new AbortController()
    const p = api('/places/search?q=Pa', { signal: c.signal })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][1].signal).toBe(c.signal)
    c.abort()
    const err = await p.catch((e) => e)
    expect(isAbortError(err)).toBe(true)
    expect(isAbortError(new Error('x'))).toBe(false)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
})
