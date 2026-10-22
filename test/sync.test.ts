import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/auth', () => ({ COGNITO_CONFIGURED: true, currentSub: vi.fn(), getUserSub: vi.fn().mockResolvedValue(null) }))
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

import { api, ApiError } from '../src/lib/api'
import { clearOutbox, enqueue, flush, pendingTouches, send } from '../src/lib/outbox'
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
import { getSyncStatus, setSyncStatus } from '../src/lib/syncStatus'
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
    let first = true
    apiMock.mockImplementation((async (path: string) => {
      if (first) { first = false; throw new TypeError('Failed to fetch') }
      return path === '/state' ? server() : undefined
    }) as never)
    enqueue({ id: 'a', method: 'PUT', path: '/a', touches: ['profile'] })
    await flush()
    expect(getSyncStatus().state).toBe('offline')
    await vi.advanceTimersByTimeAsync(1000) // backoff retry succeeds
    expect(getSyncStatus()).toMatchObject({ state: 'synced', pending: 0, lastError: undefined })
    expect(getSyncStatus().lastSyncMs).toBeTypeOf('number')
  })

  const deferred = () => {
    let resolve!: (v: unknown) => void
    const promise = new Promise((r) => (resolve = r))
    return { promise, resolve }
  }
  const tick = () => vi.advanceTimersByTimeAsync(0)
  const stateCalls = () => apiMock.mock.calls.filter(([p]) => p === '/state').length
  const answerState = (over = {}) => apiMock.mockImplementation((async (path: string) => (path === '/state' ? server(over) : undefined)) as never)

  it('pending_touches_include_a_send_waiting_its_turn_on_the_chain', async () => {
    const a = deferred()
    apiMock.mockReturnValueOnce(a.promise as never).mockResolvedValue(undefined)
    const pa = send({ id: 'friend-accept:f', method: 'POST', path: '/friends/f/accept', touches: ['friends'] })
    const pb = send({ id: 'story-save:s', method: 'PUT', path: '/stories/s', touches: ['story:s'] })
    await tick()
    expect([...pendingTouches()].sort()).toEqual(['friends', 'stories', 'story:s'])
    a.resolve(undefined)
    await Promise.all([pa, pb])
    expect(pendingTouches().size).toBe(0)
  })

  it('refresh_keeps_a_write_that_completed_during_the_fetch', async () => {
    setState({ trip: { ...srvTrip, id: 'local' } })
    const st = deferred()
    apiMock.mockImplementation(((path: string) => (path === '/state' ? st.promise : Promise.resolve({ ok: 1 }))) as never)
    const p = refreshAll()
    await tick()
    await send({ id: 'trip:local', method: 'POST', path: '/trips', touches: ['trip'] }) // settles before the response arrives
    st.resolve(server({ trip: null }))
    await p
    expect(getState().trip?.id).toBe('local')
  })

  it('concurrent_refreshAll_calls_share_one_fetch', async () => {
    const st = deferred()
    apiMock.mockImplementation(((path: string) => (path === '/state' ? st.promise : Promise.resolve())) as never)
    const p1 = refreshAll()
    const p2 = refreshAll()
    await tick()
    expect(stateCalls()).toBe(1)
    st.resolve(server())
    await Promise.all([p1, p2])
    answerState()
    await refreshAll()
    expect(stateCalls()).toBe(2) // a later refresh fetches again
  })

  it('a_successful_flush_triggers_one_refresh_including_after_backoff', async () => {
    answerState({ trip: srvTrip })
    enqueue({ id: 'a', method: 'PUT', path: '/a', touches: ['friends'] })
    await flush()
    await tick()
    expect(stateCalls()).toBe(1)
    expect(getState().trip?.id).toBe('srv')

    apiMock.mockReset()
    answerState2()
    function answerState2() {
      let first = true
      apiMock.mockImplementation((async (path: string) => {
        if (first) { first = false; throw new TypeError('Failed to fetch') }
        return path === '/state' ? server() : undefined
      }) as never)
    }
    enqueue({ id: 'b', method: 'PUT', path: '/b', touches: ['friends'] })
    await flush()
    expect(stateCalls()).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(stateCalls()).toBe(1)
  })

  it('pendingTouches_tolerates_persisted_ops_without_touches', () => {
    enqueue({ id: 'old', method: 'PUT', path: '/old' } as never)
    expect([...pendingTouches()].sort()).toEqual(['friends', 'letters', 'profile', 'sessions', 'stamps', 'stories', 'trip'])
  })

  it('status_returns_to_synced_after_a_direct_send_with_nothing_pending', async () => {
    apiMock.mockResolvedValue({ ok: 1 })
    setSyncStatus({ state: 'offline', pending: 1 })
    await send({ id: 'trip:t', method: 'POST', path: '/trips', touches: ['trip'] })
    expect(getSyncStatus()).toMatchObject({ state: 'synced', pending: 0 })
  })

  it('background_poll_does_not_show_syncing_but_does_after_retry', async () => {
    const st = deferred()
    apiMock.mockImplementation(((path: string) => (path === '/state' ? st.promise : Promise.resolve())) as never)
    const p = refreshAll()
    await tick()
    expect(getSyncStatus().state).toBe('synced')
    st.resolve(server())
    await p
  })

  it('a_throw_while_applying_server_state_sets_error', async () => {
    apiMock.mockResolvedValue({ ...server(), get stories(): never { throw new Error('boom') } })
    await expect(refreshAll()).rejects.toThrow('boom')
    expect(getSyncStatus().state).toBe('error')
  })
})
