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
import { locate, placeLabel, reversePlace, searchBundledPlaces, searchPlaces, toCity } from '../src/lib/places'
import { getState } from '../src/lib/store'
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

  it('search_times_out_to_bundled_without_abort_signal_statics', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('AbortSignal', Object.assign(function () {}, { prototype: AbortSignal.prototype })) // no .any / .timeout
    let seen: AbortSignal | undefined
    apiMock.mockImplementation((_p, init) => ((seen = init!.signal!), new Promise((_, rej) => seen!.addEventListener('abort', () => rej(seen!.reason)))))
    const caller = new AbortController()
    const p = searchPlaces('Zagr', { kind: 'city', signal: caller.signal })
    await vi.advanceTimersByTimeAsync(3500)
    const r = await p
    expect(r.source).toBe('bundled')
    expect(caller.signal.aborted).toBe(false)
    // and the caller's abort still reaches the request
    const c2 = new AbortController()
    const p2 = searchPlaces('Zagr', { kind: 'city', signal: c2.signal })
    await vi.advanceTimersByTimeAsync(0)
    c2.abort()
    await expect(p2).rejects.toMatchObject({ name: 'AbortError' })
    vi.unstubAllGlobals()
  })

  it('place_label_includes_region_for_places_and_stored_cities', () => {
    expect(placeLabel(paris)).toBe('Paris, Ile-de-France, France')
    expect(placeLabel(toCity(paris))).toBe('Paris, Ile-de-France, France')
    expect(placeLabel({ name: 'Zagreb', country: 'Croatia' })).toBe('Zagreb, Croatia')
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

  it('cancel_after_selection_drops_a_pending_and_an_in_flight_result', async () => {
    vi.useFakeTimers()
    const pending: ReturnType<typeof deferred>[] = []
    const search = vi.fn(() => {
      const d = deferred()
      pending.push(d)
      return d.promise
    })
    const got: unknown[] = []
    const s = createPlaceSearch({ kind: 'any', search, onResult: (r) => got.push(r) })
    s.query('Par')
    await vi.advanceTimersByTimeAsync(250) // in flight
    s.query('Pari') // debounce pending
    pending[0].resolve({ places: [paris], source: 'server' }) // resolved but not yet delivered
    s.cancel() // the user picked a row
    await vi.advanceTimersByTimeAsync(500)
    expect(search).toHaveBeenCalledTimes(1)
    expect(got).toEqual([])
  })

  it('search_failure_delivers_an_empty_result_instead_of_a_dead_box', async () => {
    vi.useFakeTimers()
    const got: unknown[] = []
    const s = createPlaceSearch({ kind: 'any', search: () => Promise.reject(new Error('chunk load failed')), onResult: (r) => got.push(r) })
    s.query('Par')
    await vi.advanceTimersByTimeAsync(250)
    expect(got).toEqual([{ places: [], source: 'bundled' }])
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

describe('reversePlace', () => {
  it('reverse_place_rounds_coordinates_before_calling_api', async () => {
    apiMock.mockResolvedValue({ place: paris, source: 'photon' })
    const r = await reversePlace(48.856613, 2.352222)
    expect(r).toEqual({ place: paris, source: 'server' })
    const [path, init] = apiMock.mock.calls[0]
    const u = new URL(path, 'http://x')
    expect(u.pathname).toBe('/places/reverse')
    expect(Object.fromEntries(u.searchParams)).toEqual({ lat: '48.86', lng: '2.35' })
    expect(path).not.toContain('48.8566')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('reverse_place_falls_back_to_nearest_bundled_city_with_distance', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(503))
    const near = await reversePlace(45.814442, 15.977981)
    expect(near.source).toBe('bundled')
    expect(near.place).toMatchObject({ name: 'Zagreb', cc: 'HR' })
    expect(near.approxKm).toBeLessThan(50)
    // no Cognito: never calls the server; a remote spot reports how far the nearest city is
    flags.cognito = false
    apiMock.mockClear()
    const far = await reversePlace(23.5, 12.0) // the Sahara
    expect(apiMock).not.toHaveBeenCalled()
    expect(far.source).toBe('bundled')
    expect(far.place).not.toBeNull()
    expect(far.approxKm).toBeGreaterThan(50)
    expect(Number.isFinite(far.approxKm)).toBe(true)
  })

  it('reverse_place_ocean_from_server_returns_null_place', async () => {
    apiMock.mockResolvedValue({ place: null, source: 'photon' })
    expect(await reversePlace(-48.88, -123.39)).toEqual({ place: null, source: 'server' })
  })

  it('reverse_place_for_a_home_city_ignores_a_landmark', async () => {
    apiMock.mockResolvedValue({ place: { ...paris, id: 'photon:W5013364', name: 'Eiffel Tower', kind: 'poi' }, source: 'photon' })
    const r = await reversePlace(48.858, 2.294, 'city')
    expect(r.source).toBe('bundled')
    expect(r.place).toMatchObject({ name: expect.stringMatching(/^Paris/), cc: 'FR' }) // the bundled set has Paris districts
    expect(r.place?.name).not.toBe('Eiffel Tower')
  })
})

describe('locate', () => {
  const geoWith = (impl: Geolocation['getCurrentPosition']) => ({ getCurrentPosition: impl })

  it('geolocation_result_is_rounded_and_not_stored_raw', async () => {
    const reverse = vi.fn(async (_lat: number, _lng: number, _kind?: string) => ({ place: paris, source: 'server' as const }))
    const geo = geoWith((ok) => ok({ coords: { latitude: 48.856613, longitude: 2.352222, accuracy: 12 } } as GeolocationPosition))
    const r = await locate(geo, reverse)
    expect(reverse).toHaveBeenCalledWith(48.86, 2.35, 'city')
    expect(r).toEqual({ ok: true, place: paris, source: 'server' })
    expect(JSON.stringify(r)).not.toContain('48.8566')
    expect(JSON.stringify(getState())).not.toContain('48.8566')
  })

  it('locate_handles_permission_denied_with_friendly_message', async () => {
    const reverse = vi.fn()
    for (const code of [1, 2, 3]) {
      const geo = geoWith((_ok, fail) => fail!({ code, message: 'x', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError))
      const r = await locate(geo, reverse)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toMatch(code === 1 ? /permission/i : /could not|couldn't/i)
    }
    expect((await locate(undefined, reverse)).ok).toBe(false) // no geolocation API at all
    expect(reverse).not.toHaveBeenCalled()
  })
})
