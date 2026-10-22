import { afterEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ cognito: true }))
vi.mock('../src/lib/auth', () => ({
  get COGNITO_CONFIGURED() {
    return flags.cognito
  },
}))
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

import { api, ApiError } from '../src/lib/api'
import { attributionFor, createPlaceSearch, HOME_SEARCH_KIND } from '../src/lib/placeSearch'
import { searchBundledPlaces, searchPlaces, toCity } from '../src/lib/places'
import type { Place } from '../src/lib/types'

const apiMock = vi.mocked(api)
const paris: Place = { id: 'photon:R7444', name: 'Paris', region: 'Ile-de-France', country: 'France', cc: 'FR', lat: 48.85, lng: 2.35, kind: 'locality' }

afterEach(() => {
  apiMock.mockReset()
  flags.cognito = true
  vi.useRealTimers()
})

describe('searchPlaces', () => {
  it('search_uses_server_results_when_available', async () => {
    apiMock.mockResolvedValue({ places: [paris], source: 'photon' })
    const r = await searchPlaces('Par', { kind: 'city', bias: [45.81444, 15.97798] })
    expect(r).toEqual({ places: [paris], source: 'server' })
    const [path, init] = apiMock.mock.calls[0]
    const u = new URL(path, 'http://x')
    expect(u.pathname).toBe('/places/search')
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: 'Par', kind: 'city', lat: '45.81', lng: '15.98' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('search_falls_back_to_bundled_on_429_503_timeout_and_offline_with_source_bundled', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    for (const err of [new ApiError(429), new ApiError(503), timeout, new TypeError('Failed to fetch')]) {
      apiMock.mockRejectedValueOnce(err)
      const r = await searchPlaces('Zagr', { kind: 'any' })
      expect(r.source).toBe('bundled')
      expect(r.places[0]).toMatchObject({ name: 'Zagreb', cc: 'HR' })
    }
    // no Cognito (DEMO / offline dev): never calls the server
    flags.cognito = false
    apiMock.mockClear()
    expect((await searchPlaces('Zagr', { kind: 'city' })).source).toBe('bundled')
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('search_aborted_by_the_caller_rejects_instead_of_falling_back', async () => {
    const c = new AbortController()
    apiMock.mockImplementation((_p, init) => new Promise((_, rej) => init!.signal!.addEventListener('abort', () => rej(init!.signal!.reason))))
    const p = searchPlaces('Zagr', { kind: 'city', signal: c.signal })
    c.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('search_is_diacritic_insensitive_in_bundled_fallback', async () => {
    flags.cognito = false
    expect((await searchPlaces('São Pa', { kind: 'city' })).places[0]).toMatchObject({ name: 'Sao Paulo', cc: 'BR' })
    expect((await searchBundledPlaces('sao pa', 1))[0]).toMatchObject({ name: 'Sao Paulo' })
  })

  it('to_city_keeps_region_and_place_id', () => {
    expect(toCity(paris)).toEqual({ name: 'Paris', region: 'Ile-de-France', country: 'France', cc: 'FR', lat: 48.85, lng: 2.35, placeId: 'photon:R7444' })
    const { region: _r, ...noRegion } = paris
    expect(toCity(noRegion)).not.toHaveProperty('region')
  })
})

describe('createPlaceSearch', () => {
  const deferred = () => {
    let resolve!: (v: { places: Place[]; source: 'server' | 'bundled' }) => void
    const promise = new Promise<{ places: Place[]; source: 'server' | 'bundled' }>((r) => (resolve = r))
    return { promise, resolve }
  }

  it('search_debounces_and_aborts_the_previous_request', async () => {
    vi.useFakeTimers()
    const calls: { q: string; signal: AbortSignal }[] = []
    const search = vi.fn((q: string, o: { signal?: AbortSignal }) => (calls.push({ q, signal: o.signal! }), deferred().promise))
    const s = createPlaceSearch({ kind: 'any', search, onResult: () => {} })
    s.query('Pa')
    s.query('Par')
    await vi.advanceTimersByTimeAsync(249)
    expect(search).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(calls.map((c) => c.q)).toEqual(['Par'])
    s.query('Pari')
    expect(calls[0].signal.aborted).toBe(true) // the keystroke aborts the in-flight request
    await vi.advanceTimersByTimeAsync(250)
    expect(calls.map((c) => c.q)).toEqual(['Par', 'Pari'])
    expect(calls[1].signal.aborted).toBe(false)
  })

  it('search_ignores_out_of_order_responses', async () => {
    vi.useFakeTimers()
    const pending: ReturnType<typeof deferred>[] = []
    // a search that ignores its abort signal, so both responses arrive
    const search = vi.fn(() => {
      const d = deferred()
      pending.push(d)
      return d.promise
    })
    const got: unknown[] = []
    const s = createPlaceSearch({ kind: 'any', search, onResult: (r) => got.push(r) })
    s.query('Lon')
    await vi.advanceTimersByTimeAsync(250)
    s.query('Lond')
    await vi.advanceTimersByTimeAsync(250)
    const newer = { places: [paris], source: 'server' as const }
    pending[1].resolve(newer)
    await vi.advanceTimersByTimeAsync(0)
    pending[0].resolve({ places: [], source: 'server' }) // the older request resolves last
    await vi.advanceTimersByTimeAsync(0)
    expect(got).toEqual([newer])
  })

  it('search_under_two_chars_clears_without_a_request', async () => {
    vi.useFakeTimers()
    const search = vi.fn()
    const got: unknown[] = []
    const s = createPlaceSearch({ kind: 'city', search, onResult: (r) => got.push(r) })
    s.query(' P ')
    await vi.advanceTimersByTimeAsync(500)
    expect(search).not.toHaveBeenCalled()
    expect(got).toEqual([null])
  })

  it('home_city_search_never_requests_kind_any', async () => {
    expect(HOME_SEARCH_KIND).toBe('city')
    vi.useFakeTimers()
    const search = vi.fn(() => deferred().promise)
    createPlaceSearch({ kind: HOME_SEARCH_KIND, search, onResult: () => {} }).query('Zagreb')
    await vi.advanceTimersByTimeAsync(250)
    expect(search).toHaveBeenCalledWith('Zagreb', expect.objectContaining({ kind: 'city' }))
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../src/screens/HomeCity.tsx', import.meta.url), 'utf8')
    expect(src).toContain('kind: HOME_SEARCH_KIND')
    expect(src).not.toMatch(/['"]any['"]/)
  })

  it('search_results_show_osm_attribution_when_source_is_photon', () => {
    expect(attributionFor('server')).toBe('© OpenStreetMap contributors')
    expect(attributionFor('bundled')).toBeNull()
  })
})
