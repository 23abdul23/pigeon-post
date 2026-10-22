import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/auth', () => ({ COGNITO_CONFIGURED: true, currentSub: vi.fn(), getUserSub: vi.fn().mockResolvedValue(null) }))
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

const city = { name: 'Zagreb', country: 'Croatia', cc: 'HR', lat: 45.81, lng: 15.98 }
const dest = { id: 'p', name: 'Split', country: 'Croatia', cc: 'HR', lat: 43.5, lng: 16.44 }
const trip = { id: 't1', dest, route: [[45.81, 15.98], [43.5, 16.44]] as [number, number][], routeKm: 300, progressKm: 40, status: 'OUTBOUND' as const, legs: 1, letterIds: [], origin: city }
const stamp = { cc: 'HR', country: 'Croatia', firstMs: 1, visits: 1 }
const story = { id: 's1', place: 'Split', country: 'Croatia', cc: 'HR', lens: 'Legend' as const, text: 't', dateMs: 1, saved: false, birds: [], km: 40, lat: 43.5, lng: 16.44 }
const local = { user: { name: 'Ana', email: 'a@b.c' }, homeCity: city, bird: { species: 'stork', name: 'Pip' }, trip, stories: [story], stamps: [stamp], sessions: [], letters: [], friends: [] }
const empty = { profile: null, trip: null, stories: [], letters: [], friends: [], stamps: [], sessions: [], flight: null, serverTime: Date.now() }
const imported = { ...empty, profile: { name: 'Ana', homeCity: city, bird: { species: 'stork', name: 'Pip' }, settings: {}, inviteCode: 'ABCDEFGH' }, trip: { ...trip, route: undefined }, stories: [story], stamps: [stamp] }

// every test is a fresh page load: new module instances (sync keeps a "first state of this load" flag)
async function load() {
  vi.resetModules()
  const { api, ApiError } = await import('../src/lib/api')
  const { setState, getState } = await import('../src/lib/store')
  const { refreshAll } = await import('../src/lib/sync')
  vi.mocked(api).mockReset() // the mock may outlive the module reset
  return { api: vi.mocked(api), ApiError, setState, getState, refreshAll }
}
const respond = (api: ReturnType<typeof vi.mocked<typeof import('../src/lib/api').api>>, state: unknown, importResult: () => unknown) =>
  api.mockImplementation((async (path: string) => (path === '/state' ? state : importResult())) as never)

beforeEach(() => store.clear())

describe('reconcileLocal', () => {
  it('reconcile_posts_local_state_when_server_profile_is_null', async () => {
    const t = await load()
    t.setState(local)
    respond(t.api, empty, () => imported)
    await t.refreshAll()
    const call = t.api.mock.calls.find((c) => c[0] === '/import')!
    expect(call[1]?.method).toBe('POST')
    const body = JSON.parse(call[1]!.body as string)
    expect(body.profile).toMatchObject({ name: 'Ana', homeCity: city, bird: { species: 'stork', name: 'Pip' } })
    expect(body.trip.id).toBe('t1')
    expect(body.trip.route).toBeUndefined()
    expect(body.stories).toHaveLength(1)
    expect(body.stamps).toEqual([stamp])
    expect(t.getState().inviteCode).toBe('ABCDEFGH') // hydrated from the reply
    expect(t.getState().trip?.route).toEqual(trip.route)
    expect(t.getState().homeCity).toEqual(city)
  })

  it('reconcile_skips_when_server_has_a_profile', async () => {
    const t = await load()
    t.setState(local)
    respond(t.api, { ...empty, profile: imported.profile }, () => imported)
    await t.refreshAll()
    expect(t.api.mock.calls.some((c) => c[0] === '/import')).toBe(false)
    const fresh = await load()
    fresh.setState({ homeCity: null, bird: null, trip: null, stories: [], stamps: [] }) // nothing local either
    respond(fresh.api, empty, () => imported)
    await fresh.refreshAll()
    expect(fresh.api.mock.calls.some((c) => c[0] === '/import')).toBe(false)
  })

  it('reconcile_keeps_local_data_on_failure_and_retries_next_load', async () => {
    const t = await load()
    t.setState(local)
    respond(t.api, empty, () => {
      throw new Error('network down')
    })
    await t.refreshAll()
    expect(t.getState()).toMatchObject({ homeCity: city, bird: local.bird, stories: [story], stamps: [stamp], trip })
    // next page load: the import is tried again and succeeds
    const next = await load()
    respond(next.api, empty, () => imported)
    await next.refreshAll()
    expect(next.api.mock.calls.filter((c) => c[0] === '/import')).toHaveLength(1)
    expect(next.getState().inviteCode).toBe('ABCDEFGH')
  })

  it('local_profile_survives_a_null_server_profile_when_reconcile_failed', async () => {
    const t = await load()
    t.setState(local)
    respond(t.api, empty, () => {
      throw new t.ApiError(503)
    })
    await t.refreshAll()
    await t.refreshAll() // a later poll in the same load does not retry the import, but still must not wipe local data
    expect(t.api.mock.calls.filter((c) => c[0] === '/import')).toHaveLength(1)
    expect(t.getState()).toMatchObject({ homeCity: city, bird: local.bird, stories: [story], stamps: [stamp], trip })
  })
})
