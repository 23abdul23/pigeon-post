import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/auth', () => ({ COGNITO_CONFIGURED: true, currentSub: vi.fn(), getUserSub: vi.fn().mockResolvedValue(null) }))
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

import { api, ApiError } from '../src/lib/api'
import { clearOutbox, enqueue, flush } from '../src/lib/outbox'
import { getState, hydrate, setState } from '../src/lib/store'
import { refreshAll } from '../src/lib/sync'
import { withRoute } from '../src/lib/trips'

const city = { name: 'Zagreb', country: 'Croatia', cc: 'HR', lat: 45.81, lng: 15.98 }
const empty = { trip: null, stories: [], letters: [], friends: [], stamps: [], sessions: [] }

describe('sync', () => {
  it('hydrate_applies_server_profile', () => {
    setState({ user: { name: 'local', email: 'a@b.c' }, homeCity: null, bird: null })
    hydrate({ ...empty, profile: { name: 'Ana', homeCity: city, bird: { species: 'stork', name: 'Pip' }, settings: { volume: 10 } as never, inviteCode: 'ABCDEFGH' } })
    const s = getState()
    expect(s.homeCity).toEqual(city)
    expect(s.bird).toEqual({ species: 'stork', name: 'Pip' })
    expect(s.user).toEqual({ name: 'Ana', email: 'a@b.c' })
    expect(s.settings.volume).toBe(10)
    expect(s.settings.coo).toBe(true) // defaults fill missing keys
  })

  it('hydrate_null_profile_sends_user_to_onboarding', () => {
    setState({ homeCity: city, bird: { species: 'stork', name: 'Pip' }, letters: [{ id: 'local' } as never] })
    hydrate({ ...empty, profile: null, letters: [{ id: 'srv' } as never] })
    expect(getState().homeCity).toBeNull()
    expect(getState().bird).toBeNull()
    expect(getState().letters.map((l) => l.id)).toEqual(['srv']) // server-owned now
  })

  it('hydrate_takes_trip_stories_stamps_sessions_from_server', () => {
    setState({ stories: [{ id: 'local-only' } as never], stamps: [], sessions: [] })
    const trip = { id: 't', dest: { id: 'p', name: 'Split', country: 'Croatia', cc: 'HR', lat: 43.5, lng: 16.44 }, routeKm: 300, route: [], progressKm: 10, status: 'OUTBOUND' as const, legs: 1, letterIds: [] }
    const stamp = { cc: 'HR', country: 'Croatia', firstMs: 1, visits: 1 }
    hydrate({ ...empty, profile: null, trip, stories: [{ id: 'srv' } as never], stamps: [stamp] })
    expect(getState().trip).toEqual(trip)
    expect(getState().stories.map((x) => x.id)).toEqual(['srv'])
    expect(getState().stamps).toEqual([stamp])
  })

  it('withRoute_reuses_local_route_or_replans_reversed_when_returning', () => {
    const dest = { id: 'p', name: 'Split', country: 'Croatia', cc: 'HR', lat: 43.5, lng: 16.44 }
    const t = { id: 't', dest, routeKm: 300, progressKm: 0, status: 'OUTBOUND' as const, legs: 0, letterIds: [] }
    setState({ trip: { ...t, route: [[1, 1], [2, 2]] } })
    expect(withRoute(t, city)!.route).toEqual([[1, 1], [2, 2]])
    const back = withRoute({ ...t, status: 'RETURNING' }, city)!.route // a new leg: planned again, home is the end
    expect(back[0][0]).toBeCloseTo(dest.lat)
    expect(back[back.length - 1][1]).toBeCloseTo(city.lng)
    expect(withRoute({ ...t, id: 'other' }, null)).toBeNull()
  })

})

// the status store, read the way useSyncStatus does (the hook is a thin useSyncExternalStore over it)
import { getSyncStatus } from '../src/lib/syncStatus'
const apiMock = vi.mocked(api)
const dest = { id: 'p', name: 'Split', country: 'Croatia', cc: 'HR', lat: 43.5, lng: 16.44 }
const srvTrip = { id: 'srv', dest, routeKm: 300, route: [] as [number, number][], progressKm: 10, status: 'OUTBOUND' as const, legs: 1, letterIds: [] }
const server = (over = {}) => ({ ...empty, profile: { name: 'Srv', homeCity: city, bird: { species: 'stork', name: 'Srv' }, settings: {}, inviteCode: 'X' }, ...over })

describe('per-entity refresh and sync status', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMock.mockReset()
    clearOutbox()
    store.clear()
    setState({ trip: null, letters: [], homeCity: city, bird: { species: 'stork', name: 'Local' } })
  })
  afterEach(async () => {
    apiMock.mockResolvedValue(undefined)
    await vi.runAllTimersAsync()
    clearOutbox()
    vi.useRealTimers()
  })

  it('refresh_takes_server_trip_while_a_letter_op_is_pending', async () => {
    enqueue({ id: 'letter:l1', method: 'POST', path: '/letters', touches: ['letter:l1'] })
    setState({ letters: [{ id: 'l1' } as never] })
    apiMock.mockResolvedValueOnce(server({ trip: srvTrip, letters: [] }))
    await refreshAll()
    expect(getState().trip?.id).toBe('srv') // trip is not protected by a letter op
    expect(getState().letters.map((l) => l.id)).toEqual(['l1']) // the unsent letter survives
  })

  it('refresh_keeps_local_profile_while_a_profile_op_is_pending', async () => {
    enqueue({ id: 'me', method: 'PUT', path: '/me', touches: ['profile'] })
    apiMock.mockResolvedValueOnce(server({ trip: srvTrip }))
    await refreshAll()
    expect(getState().bird?.name).toBe('Local')
    expect(getState().trip?.id).toBe('srv')
  })

  it('status_is_offline_with_pending_count_after_network_error', async () => {
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'))
    enqueue({ id: 'a', method: 'PUT', path: '/a', touches: ['profile'] })
    enqueue({ id: 'b', method: 'PUT', path: '/b', touches: ['friends'] })
    await flush()
    expect(getSyncStatus()).toMatchObject({ state: 'offline', pending: 2 })
  })

  it('status_is_error_with_message_after_a_dropped_4xx', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(400, 'bad name'))
    enqueue({ id: 'me', method: 'PUT', path: '/me', touches: ['profile'] })
    await flush()
    expect(getSyncStatus().state).toBe('error')
    expect(getSyncStatus().lastError).toBe('Could not save your profile: bad name')
  })

  it('status_returns_to_synced_after_flush', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(undefined)
    enqueue({ id: 'a', method: 'PUT', path: '/a', touches: ['profile'] })
    await flush()
    expect(getSyncStatus().state).toBe('offline')
    await vi.advanceTimersByTimeAsync(1000) // backoff retry succeeds
    expect(getSyncStatus()).toMatchObject({ state: 'synced', pending: 0, lastError: undefined })
    expect(getSyncStatus().lastSyncMs).toBeTypeOf('number')
  })
})
