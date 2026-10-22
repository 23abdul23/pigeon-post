import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/auth', () => ({ COGNITO_CONFIGURED: true, currentSub: vi.fn(), getUserSub: vi.fn().mockResolvedValue(null) }))
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))
vi.mock('../src/lib/stories', () => ({
  buildStory: vi.fn(async (lat: number, lng: number, km: number) => ({ place: 'Plitvice', country: 'Croatia', cc: 'HR', lens: 'Nature', text: 'Lakes.', birds: [], km, lat, lng })),
}))

import { api, ApiError } from '../src/lib/api'
import { deviceId, serverNow } from '../src/lib/device'
import { flightIds, flightRole, heartbeat, landIfStillOwner, landSession, markLeft, startSession, takeOver } from '../src/lib/flight'
import { clearOutbox, enqueue } from '../src/lib/outbox'
import { getState, setState, type ActiveFlight, type Trip } from '../src/lib/store'
import { refreshAll } from '../src/lib/sync'
import { withRoute } from '../src/lib/trips'

const apiMock = vi.mocked(api)
const home = { name: 'Zagreb', country: 'Croatia', cc: 'HR', lat: 45.81, lng: 15.98 }
const dest = { id: 'p', name: 'Split', country: 'Croatia', cc: 'HR', lat: 43.5, lng: 16.44 }
const trip: Trip = { id: 't1', dest, routeKm: 10000, route: [[45.81, 15.98], [43.5, 16.44]], progressKm: 300, status: 'OUTBOUND', legs: 2, letterIds: [] }
const empty = { trip: null, stories: [], letters: [], friends: [], stamps: [], sessions: [] }
const server = (over = {}) => ({ ...empty, profile: { name: 'Srv', homeCity: home, bird: { species: 'stork', name: 'Srv' }, settings: {}, inviteCode: 'X' }, trip, serverTime: Date.now(), flight: null, ...over })
const foreign = (over: Partial<ActiveFlight> = {}): ActiveFlight => ({ tripId: 't1', startMs: Date.now() - 60000, durationMin: 25, baseKm: 300, deviceId: 'other-device-1', heartbeatMs: Date.now(), legs: 2, ...over })
const flightCalls = () => apiMock.mock.calls.filter(([p]) => p === '/flight')
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)

describe('flight handoff', () => {
  beforeEach(() => {
    apiMock.mockReset()
    clearOutbox()
    setState({ trip, session: null, landing: null, flight: null, clockOffsetMs: 0, homeCity: home, stories: [], sessions: [], stamps: [] })
  })

  it('start_session_enqueues_flight_put_with_device_id', async () => {
    apiMock.mockImplementation((async (_p: string, init: RequestInit) => ({ ...JSON.parse(init.body as string), heartbeatMs: Date.now() })) as never)
    startSession(trip, 25)
    await vi.waitFor(() => expect(flightCalls()).toHaveLength(1))
    const [call] = flightCalls()
    expect(call[1]).toMatchObject({ method: 'PUT' })
    expect(bodyOf(call)).toMatchObject({ tripId: 't1', durationMin: 25, baseKm: 300, legs: 2, deviceId: deviceId(), startMs: getState().session!.startMs })
    await vi.waitFor(() => expect(getState().flight?.deviceId).toBe(deviceId()))
    expect(flightRole()).toBe('owner')
  })

  it('refresh_with_foreign_flight_makes_role_observer', async () => {
    apiMock.mockResolvedValue(server({ flight: foreign() }) as never)
    await refreshAll()
    expect(getState().flight?.deviceId).toBe('other-device-1')
    expect(flightRole()).toBe('observer')
    // a stale foreign flight leaves the user free to fly
    apiMock.mockResolvedValue(server({ flight: foreign({ heartbeatMs: Date.now() - 91000 }) }) as never)
    await refreshAll()
    expect(flightRole()).toBe('none')
  })

  it('observer_does_not_heartbeat_or_land', async () => {
    setState({ flight: foreign() })
    heartbeat()
    expect(await landSession('ended')).toBeNull()
    await new Promise((r) => setTimeout(r, 10))
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('observer_does_not_land', async () => {
    const f = foreign()
    setState({ flight: f })
    const { sessionId, storyId } = flightIds(f)
    // the other device landed: the refresh brings its session and story, this device posts nothing
    apiMock.mockResolvedValue(server({ flight: null, sessions: [{ id: sessionId, tripId: 't1', startMs: f.startMs, endMs: Date.now(), km: 500, reason: 'completed' }], stories: [{ id: storyId } as never] }) as never)
    await refreshAll()
    expect(flightRole()).toBe('none')
    expect(getState().session).toBeNull()
    expect(getState().stories.map((s) => s.id)).toEqual([storyId])
    expect(apiMock.mock.calls.every(([p]) => p === '/state')).toBe(true)
  })

  it('take_over_sends_takeover_true_and_becomes_owner', async () => {
    const f = foreign()
    setState({ flight: f })
    apiMock.mockImplementation((async (_p: string, init: RequestInit) => ({ ...JSON.parse(init.body as string), heartbeatMs: Date.now() })) as never)
    await takeOver()
    const [call] = flightCalls()
    expect(bodyOf(call)).toMatchObject({ tripId: 't1', startMs: f.startMs, durationMin: 25, baseKm: 300, legs: 2, deviceId: deviceId(), takeover: true })
    expect(getState().session).toMatchObject({ tripId: 't1', startMs: f.startMs, baseKm: 300, durationMin: 25 })
    expect(getState().flight?.deviceId).toBe(deviceId())
    expect(flightRole()).toBe('owner')
  })

  it('put_flight_409_switches_to_observer_with_server_flight', async () => {
    const f = foreign()
    apiMock.mockRejectedValue(new ApiError(409, 'owned', { flight: f }))
    startSession(trip, 25)
    await vi.waitFor(() => expect(getState().session).toBeNull())
    expect(getState().flight).toEqual(f)
    expect(flightRole()).toBe('observer')
  })

  it('put_flight_409_already_landed_drops_local_flight', async () => {
    apiMock.mockImplementation((async (p: string) => {
      if (p === '/flight') throw new ApiError(409, 'landed', { error: 'flight already landed' })
      return server()
    }) as never)
    startSession(trip, 25)
    await vi.waitFor(() => expect(getState().session).toBeNull())
    expect(flightRole()).toBe('none')
    await vi.waitFor(() => expect(apiMock.mock.calls.some(([p]) => p === '/state')).toBe(true)) // and refreshes
  })

  it('owner_leaving_tab_sends_left_at_to_server', async () => {
    apiMock.mockImplementation((async (_p: string, init: RequestInit) => ({ ...JSON.parse(init.body as string), heartbeatMs: Date.now() })) as never)
    const startMs = serverNow() - 60000
    setState({ session: { tripId: 't1', startMs, durationMin: 25, baseKm: 300, legs: 2, leftAtMs: startMs + 30000 } })
    heartbeat()
    await vi.waitFor(() => expect(flightCalls()).toHaveLength(1))
    expect(bodyOf(flightCalls()[0])).toMatchObject({ startMs, leftAtMs: startMs + 30000, deviceId: deviceId() })
  })

  it('refresh_drops_local_session_when_server_flight_is_gone_and_no_pending_flight_write', async () => {
    const session = { tripId: 't1', startMs: Date.now() - 60000, durationMin: 25, baseKm: 300, legs: 2 }
    setState({ session })
    enqueue({ id: 'flight:t1', method: 'PUT', path: '/flight', touches: ['flight'] })
    apiMock.mockResolvedValue(server() as never)
    await refreshAll()
    expect(getState().session).toEqual(session) // its PUT is still pending: keep it
    clearOutbox()
    await refreshAll()
    expect(getState().session).toBeNull() // landed or ended on another device
    // a session started moments ago is kept (its PUT may not have reached the server yet)
    setState({ session: { ...session, startMs: Date.now() - 2000 } })
    await refreshAll()
    expect(getState().session).not.toBeNull()
  })

  it('with_route_uses_trip_origin_not_current_home', () => {
    setState({ trip: null })
    const origin = { name: 'Lisbon', country: 'Portugal', cc: 'PT', lat: 38.72, lng: -9.14 }
    const t = { ...trip, id: 'fresh', origin }
    const r = withRoute(t, home)!.route
    expect(r[0][0]).toBeCloseTo(origin.lat)
    expect(r[0][1]).toBeCloseTo(origin.lng)
    expect(withRoute({ ...t, origin: undefined }, home)!.route[0][0]).toBeCloseTo(home.lat) // older trips: current home
  })

  const leftSession = () => {
    const startMs = serverNow() - 60000
    return { tripId: 't1', startMs, durationMin: 25, baseKm: 300, legs: 2, leftAtMs: startMs + 30000, heartbeatMs: startMs + 30000 }
  }
  const paths = () => apiMock.mock.calls.map(([p]) => p)

  it('returning_device_refreshes_before_landing_left', async () => {
    const session = leftSession()
    setState({ session })
    const mine = { ...session, deviceId: deviceId(), heartbeatMs: Date.now() - 30000 }
    apiMock.mockImplementation((async (p: string) => (p === '/state' ? server({ flight: mine }) : undefined)) as never)
    const landing = await landIfStillOwner('left')
    expect(landing).toMatchObject({ reason: 'left', tripId: 't1' })
    await vi.waitFor(() => expect(paths()).toContain('/trips/t1/sessions'))
    expect(paths()).toContain('/state')
    expect(paths().indexOf('/state')).toBeLessThan(paths().indexOf('/trips/t1/sessions'))
  })

  it('returning_device_taken_over_does_not_land', async () => {
    const session = leftSession()
    setState({ session })
    apiMock.mockImplementation((async (p: string) => (p === '/state' ? server({ flight: foreign({ startMs: session.startMs }) }) : undefined)) as never)
    expect(await landIfStillOwner('left')).toBeNull()
    expect(getState().session).toBeNull()
    expect(flightRole()).toBe('observer')
    await new Promise((r) => setTimeout(r, 10))
    expect(paths()).toEqual(['/state'])
  })

  it('offline_returning_device_still_lands_left', async () => {
    setState({ session: leftSession() })
    apiMock.mockImplementation((async (p: string) => {
      if (p === '/state') throw new TypeError('Failed to fetch')
    }) as never)
    expect(await landIfStillOwner('left')).toMatchObject({ reason: 'left' })
    expect(getState().session).toBeNull()
  })

  it('mark_left_freezes_the_session_and_sends_left_at', async () => {
    apiMock.mockImplementation((async (_p: string, init: RequestInit) => ({ ...JSON.parse(init.body as string), heartbeatMs: Date.now() })) as never)
    setState({ session: { tripId: 't1', startMs: serverNow() - 60000, durationMin: 25, baseKm: 300, legs: 2 } })
    markLeft()
    const left = getState().session!.leftAtMs!
    expect(left).toBeGreaterThan(serverNow() - 1000)
    await vi.waitFor(() => expect(flightCalls()).toHaveLength(1))
    expect(bodyOf(flightCalls()[0])).toMatchObject({ leftAtMs: left })
    markLeft() // already left: nothing more
    expect(getState().session!.leftAtMs).toBe(left)
  })

  // last in the file: the hanging refresh stays the shared in-flight pull
  it('returning_device_lands_after_refresh_timeout_when_network_hangs', async () => {
    vi.useFakeTimers()
    try {
      setState({ session: leftSession() })
      apiMock.mockImplementation((() => new Promise(() => {})) as never) // lie-fi: nothing ever answers
      let landed: unknown = 'pending'
      void landIfStillOwner('left').then((l) => (landed = l))
      await vi.advanceTimersByTimeAsync(3900)
      expect(landed).toBe('pending')
      expect(getState().session).not.toBeNull()
      await vi.advanceTimersByTimeAsync(200)
      expect(landed).toMatchObject({ reason: 'left', tripId: 't1' })
      expect(getState().session).toBeNull()
      expect(getState().stories).toHaveLength(1) // landed exactly once
    } finally {
      vi.useRealTimers()
    }
  })
})
