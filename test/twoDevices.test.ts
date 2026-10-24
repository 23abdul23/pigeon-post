// Two client instances (laptop and phone: separate module instances, localStorage, device ids and device clocks) signed in as
// the same user, talking to one in-memory server (test/helpers/fakeServer.ts) through the real outbox, sync and flight code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeServer, type FakeServer } from './helpers/fakeServer'

vi.mock('../src/lib/stories', () => ({
  buildStory: vi.fn(async (lat: number, lng: number, km: number) => ({ place: 'Plitvice', country: 'Croatia', cc: 'HR', lens: 'Nature', text: 'Lakes.', birds: [], km, lat, lng })),
}))

const MIN = 60_000
const SUB = 'google-user-1'
const home = { name: 'Samobor', region: 'Zagreb County', country: 'Croatia', cc: 'HR', lat: 45.8, lng: 15.71, placeId: 'photon:N1' }
const dest = { id: 'photon:R2', name: 'Lisbon', country: 'Portugal', cc: 'PT', lat: 38.72, lng: -9.14, kind: 'locality' as const }

type Dev = Awaited<ReturnType<typeof device>>
type DevState = { name: string; sub: string; online: boolean; skewMs: number; storage: Map<string, string> }
let server: FakeServer
/** The device being driven (see `on`): its network, signed-in user, storage and clock. Mocked modules are shared across
 * `vi.resetModules()`, so api and auth follow this rather than binding to one module instance. */
let current: DevState | undefined

vi.mock('../src/lib/auth', () => ({ COGNITO_CONFIGURED: true, currentSub: () => current!.sub, getUserSub: async () => current!.sub }))
vi.mock('../src/lib/api', async (orig) => {
  const real = await orig<typeof import('../src/lib/api')>()
  const api = async (path: string, init?: RequestInit) => {
    const dev = current!
    if (!dev.online) throw new TypeError('Failed to fetch')
    const r = server.handle(dev.sub, path, init)
    if (r.status >= 400) throw new real.ApiError(r.status, undefined, r.body)
    return r.body
  }
  return { ...real, api }
})

// Everything a device keeps in globals (localStorage, its clock) follows the device being driven by `on`.
vi.stubGlobal('localStorage', {
  getItem: (k: string) => current!.storage.get(k) ?? null,
  setItem: (k: string, v: string) => void current!.storage.set(k, v),
  removeItem: (k: string) => void current!.storage.delete(k),
})

/** A fresh page load: new module instances bound to this device's storage, clock, network and signed-in user. */
async function device(name: string, opts: { skewMs?: number; storage?: Map<string, string>; sub?: string } = {}) {
  const dev: DevState = { name, sub: opts.sub ?? SUB, online: true, skewMs: opts.skewMs ?? 0, storage: opts.storage ?? new Map<string, string>() }
  current = dev
  vi.resetModules()
  vi.doUnmock('../src/lib/sync')
  const [store, sync, flight, outbox, deviceMod, trips, status, reconcile] = await Promise.all([
    import('../src/lib/store'),
    import('../src/lib/sync'),
    import('../src/lib/flight'),
    import('../src/lib/outbox'),
    import('../src/lib/device'),
    import('../src/lib/trips'),
    import('../src/lib/syncStatus'),
    import('../src/lib/reconcile'),
  ])
  return { ...dev, dev, id: deviceMod.deviceId(), store, sync, flight, outbox, device: deviceMod, trips, status, reconcile }
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0))
}

/** Runs `fn` as `d` (its storage, clock and lazy `import('./sync')`), then lets its background writes finish. */
async function on<T>(d: Dev, fn: () => T | Promise<T>): Promise<T> {
  current = d.dev
  vi.doMock('../src/lib/sync', () => d.sync)
  const r = await fn()
  await settle()
  return r
}

const st = (d: Dev) => d.store.getState()
/** The km this device shows for the flight in progress (its own session, or the one it observes), on the server clock. */
const km = (d: Dev) =>
  on(d, () => {
    const { session, flight, trip } = st(d)
    return d.flight.computeProgress((session ?? flight)!, trip!, d.device.serverNow()).km
  })
const db = () => server.db(SUB)

/** Server time passes while each owner sends its 30 s heartbeat (the Focus screen's timer). */
async function fly(ms: number, ...owners: Dev[]) {
  for (let t = 0; t < ms; t += 30_000) {
    server.advance(Math.min(30_000, ms - t))
    for (const d of owners) await on(d, () => d.flight.heartbeat())
  }
}

/** Signs in on `d` and onboards: home town, bird, a trip. */
async function onboard(d: Dev) {
  await on(d, async () => {
    await d.sync.loadServerState()
    d.store.setState({ user: { name: 'Ana', email: 'ana@example.com' }, homeCity: home, bird: { species: 'stork', name: 'Pip' } })
    d.sync.saveProfile()
    d.trips.createTrip(dest)
  })
  expect(db().trip?.id).toBe(st(d).trip!.id)
}

async function signIn(name: string, opts?: Parameters<typeof device>[1]) {
  const d = await device(name, opts)
  await on(d, () => d.sync.loadServerState())
  return d
}

beforeEach(() => {
  server = fakeServer()
  vi.spyOn(Date, 'now').mockImplementation(() => server.now() + (current?.skewMs ?? 0))
})
afterEach(() => {
  vi.restoreAllMocks()
  current = undefined
})

describe('two devices, one account', { timeout: 30_000 }, () => {
  it('phone_starts_flight_laptop_sees_it_as_observer', async () => {
    const laptop = await device('laptop')
    await onboard(laptop)
    const phone = await signIn('phone')
    expect(st(phone).trip?.id).toBe(st(laptop).trip!.id)
    expect(st(phone).trip!.route.length).toBeGreaterThan(1) // planned from the trip's origin

    await on(phone, () => phone.flight.startSession(st(phone).trip!, 25))
    expect(db().flight).toMatchObject({ deviceId: phone.id, tripId: st(phone).trip!.id, startMs: server.now(), baseKm: 0 })

    await fly(5 * MIN, phone)
    await on(laptop, () => laptop.sync.refreshAll())
    expect(await on(laptop, () => laptop.flight.flightRole())).toBe('observer')
    expect(await km(laptop)).toBeCloseTo(500, 6)
    expect(await km(phone)).toBeCloseTo(500, 6)

    // the observer never heartbeats or lands
    const sent = server.calls.length
    await on(laptop, async () => {
      laptop.flight.heartbeat()
      expect(await laptop.flight.landSession('ended')).toBeNull()
    })
    expect(server.calls.length).toBe(sent)
    // the phone keeps flying it
    server.advance(30_000)
    await on(phone, () => phone.flight.heartbeat())
    expect(db().flight).toMatchObject({ deviceId: phone.id, heartbeatMs: server.now() })
    expect(await on(phone, () => phone.flight.flightRole())).toBe('owner')
  })

  it('laptop_takes_over_and_lands_once', async () => {
    const laptop = await device('laptop')
    await onboard(laptop)
    const phone = await signIn('phone')
    await on(phone, () => phone.flight.startSession(st(phone).trip!, 10))
    const startMs = db().flight!.startMs

    await fly(2 * MIN, phone)
    await on(laptop, async () => {
      await laptop.sync.refreshAll()
      await laptop.flight.takeOver()
    })
    expect(db().flight).toMatchObject({ deviceId: laptop.id, startMs, baseKm: 0 })
    expect(await on(laptop, () => laptop.flight.flightRole())).toBe('owner')
    expect(await km(laptop)).toBeCloseTo(200, 6) // continues where the phone was

    // the phone's next heartbeat learns it lost the flight and becomes the observer
    server.advance(30_000)
    await on(phone, () => phone.flight.heartbeat())
    expect(st(phone).session).toBeNull()
    expect(await on(phone, () => phone.flight.flightRole())).toBe('observer')
    expect(db().flight?.deviceId).toBe(laptop.id)

    await fly(7.5 * MIN, laptop)
    const landing = await on(laptop, () => laptop.flight.landSession('completed'))
    expect(landing).toMatchObject({ km: 1000, gainedKm: 1000 })
    expect(await on(phone, () => phone.flight.landSession('completed'))).toBeNull() // nothing to land

    const after = db()
    expect(after.flight).toBeNull()
    expect(after.sessions).toHaveLength(1)
    expect(after.stories).toHaveLength(1)
    expect(after.stamps).toEqual([expect.objectContaining({ cc: 'HR', visits: 1 })])
    expect(after.trip).toMatchObject({ progressKm: 1000, legs: 1 })

    await on(phone, () => phone.sync.refreshAll())
    for (const d of [laptop, phone]) {
      expect(st(d).stories.map((s) => s.id)).toEqual([landing!.storyId])
      expect(st(d).stamps).toEqual([expect.objectContaining({ cc: 'HR', visits: 1 })])
      expect(st(d).trip).toMatchObject({ progressKm: 1000, legs: 1 })
      expect(await on(d, () => d.flight.flightRole())).toBe('none')
    }
  })

  it('both_devices_land_same_flight_yields_one_session_one_stamp', async () => {
    const laptop = await device('laptop')
    await onboard(laptop)
    const phone = await signIn('phone')
    await on(phone, () => phone.flight.startSession(st(phone).trip!, 10))
    await fly(9.75 * MIN, phone)
    await on(laptop, async () => {
      await laptop.sync.refreshAll()
      await laptop.flight.takeOver()
    })
    // the flight ends before the phone's next heartbeat, so it has not heard: both land
    server.advance(15_000)
    const fromPhone = await on(phone, () => phone.flight.landSession('completed'))
    const fromLaptop = await on(laptop, () => laptop.flight.landSession('completed'))
    expect(fromPhone!.storyId).toBe(fromLaptop!.storyId)

    const after = db()
    expect(after.sessions).toHaveLength(1)
    expect(after.stories).toHaveLength(1)
    expect(after.stamps).toEqual([expect.objectContaining({ cc: 'HR', visits: 1 })])
    expect(after.trip).toMatchObject({ progressKm: 1000, legs: 1 })
    expect(after.flight).toBeNull()

    for (const d of [phone, laptop]) {
      await on(d, () => d.sync.refreshAll())
      expect(st(d).stories).toHaveLength(1)
      expect(st(d).sessions).toHaveLength(1)
      expect(st(d).stamps).toEqual([expect.objectContaining({ cc: 'HR', visits: 1 })])
      expect(st(d).trip).toMatchObject({ progressKm: 1000, legs: 1 })
      expect(d.status.getSyncStatus().state).toBe('synced')
    }
  })

  it('offline_phone_start_then_reconnect_conflicts_cleanly', async () => {
    const laptop = await device('laptop')
    await onboard(laptop)
    const phone = await signIn('phone')
    phone.dev.online = false
    await on(laptop, () => laptop.flight.startSession(st(laptop).trip!, 10))
    await on(phone, () => phone.flight.startSession(st(phone).trip!, 10)) // queued: the phone cannot reach the server
    expect(st(phone).session).not.toBeNull()
    expect(phone.outbox.pendingOps()).toBe(1)

    await fly(MIN, laptop)
    phone.dev.online = true
    await on(phone, () => phone.outbox.flush()) // back online: the queued PUT /flight meets the laptop's fresh flight

    expect(db().flight?.deviceId).toBe(laptop.id) // never replaced
    expect(st(phone).session).toBeNull()
    expect(await on(phone, () => phone.flight.flightRole())).toBe('observer')
    expect(await km(phone)).toBeCloseTo(await km(laptop), 6)
    expect(phone.status.getSyncStatus()).toMatchObject({ state: 'synced', pending: 0 }) // a lost race is not a sync failure

    await fly(9 * MIN, laptop)
    await on(laptop, () => laptop.flight.landSession('completed'))
    await on(phone, () => phone.sync.refreshAll())
    expect(db().sessions).toHaveLength(1)
    expect(st(phone).stories).toHaveLength(1)
    expect(st(phone).trip).toMatchObject({ progressKm: 1000, legs: 1 })
  })

  it('clock_skewed_device_shows_same_km', async () => {
    const laptop = await device('laptop', { skewMs: 4 * MIN }) // laptop clock 4 minutes fast
    await onboard(laptop)
    const phone = await signIn('phone', { skewMs: -3 * MIN }) // phone clock 3 minutes slow
    await on(phone, () => phone.flight.startSession(st(phone).trip!, 25))
    expect(db().flight!.startMs).toBe(server.now()) // stored in server time

    await fly(4 * MIN, phone)
    await on(laptop, () => laptop.sync.refreshAll())
    expect(await km(phone)).toBeCloseTo(400, 6)
    expect(await km(laptop)).toBeCloseTo(400, 6)

    // the laptop takes over; the phone, now observing, still agrees
    await on(laptop, () => laptop.flight.takeOver())
    await on(phone, () => phone.sync.refreshAll())
    await fly(6 * MIN, laptop)
    expect(await km(phone)).toBeCloseTo(1000, 6)
    expect(await km(laptop)).toBeCloseTo(1000, 6)
  })

  it('first_sign_in_on_new_device_restores_everything', async () => {
    // the laptop used Pigeon Post before saving worked: everything is local only, owned by nobody yet
    const laptopStorage = new Map<string, string>()
    const old = await device('laptop', { storage: laptopStorage })
    const story = { id: 'story-1', place: 'Plitvice', country: 'Croatia', cc: 'HR', lens: 'Nature' as const, text: 'Lakes.', dateMs: server.now() - 86_400_000, saved: true, birds: [], km: 300, lat: 44.88, lng: 15.62 }
    const session = { id: 'session-1', tripId: 'trip-1', startMs: server.now() - 86_400_000 - 3 * MIN, endMs: server.now() - 86_400_000, km: 300, reason: 'completed' as const }
    await on(old, () => {
      const trip = { id: 'trip-1', dest, route: old.trips.planRoute([home.lat, home.lng], [dest.lat, dest.lng]), routeKm: 2600, progressKm: 300, status: 'OUTBOUND' as const, legs: 1, letterIds: [], origin: home }
      old.store.setState({ user: { name: 'Ana', email: 'ana@example.com' }, homeCity: home, bird: { species: 'stork', name: 'Pip' }, trip, stories: [story], stamps: [{ cc: 'HR', country: 'Croatia', firstMs: story.dateMs, visits: 1 }], sessions: [session] })
    })
    const laptop = await signIn('laptop', { storage: laptopStorage })
    expect(server.calls.filter((c) => c.path === '/import')).toHaveLength(1)
    expect(db()).toMatchObject({ profile: { name: 'Ana', homeCity: home, bird: { species: 'stork', name: 'Pip' } }, trip: { id: 'trip-1', progressKm: 300, legs: 1 } })
    expect(db().importedAt).toBe(server.now())
    expect(st(laptop).ownerSub).toBe(SUB)

    const phone = await signIn('phone')
    const s = st(phone)
    expect(s.homeCity).toEqual(home)
    expect(s.bird).toEqual({ species: 'stork', name: 'Pip' })
    expect(s.user).toBeNull() // the name comes with the sign-in, not the server
    expect(s.inviteCode).toBe(db().profile!.inviteCode)
    expect(s.trip).toMatchObject({ id: 'trip-1', progressKm: 300, legs: 1, origin: home })
    expect(s.trip!.route[0][0]).toBeCloseTo(home.lat)
    expect(s.stories).toEqual([story])
    expect(s.stamps).toEqual([expect.objectContaining({ cc: 'HR', visits: 1 })])
    expect(s.sessions).toEqual([session])
    expect(phone.status.getSyncStatus().state).toBe('synced')

    // reloading the laptop does not import again, and the server refuses a second import
    const again = await signIn('laptop', { storage: laptopStorage })
    expect(server.calls.filter((c) => c.path === '/import')).toHaveLength(1)
    expect(await on(again, () => again.reconcile.reconcileLocal())).toBe(false)
    expect(db().stories).toHaveLength(1)

    // another Google account on the phone gets a clean device; switching back restores everything from the server
    phone.dev.sub = 'google-user-2'
    await on(phone, () => phone.sync.loadServerState())
    expect(st(phone)).toMatchObject({ homeCity: null, bird: null, trip: null, stories: [], stamps: [], sessions: [], ownerSub: 'google-user-2' })
    expect(server.db('google-user-2').profile).toBeNull()
    phone.dev.sub = SUB
    const back = await signIn('phone', { storage: phone.dev.storage })
    expect(st(back)).toMatchObject({ homeCity: home, trip: { id: 'trip-1' }, stories: [story], ownerSub: SUB })
  })
})
