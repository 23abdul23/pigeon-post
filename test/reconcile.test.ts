import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
const who = vi.hoisted(() => ({ sub: 'A' as string | null }))
vi.mock('../src/lib/auth', () => ({ COGNITO_CONFIGURED: true, currentSub: () => who.sub, getUserSub: () => Promise.resolve(who.sub) }))
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
  const { refreshAll, loadServerState, saveProfile, OwnerUnknown } = await import('../src/lib/sync')
  const { pendingOps } = await import('../src/lib/outbox')
  vi.mocked(api).mockReset() // the mock may outlive the module reset
  return { api: vi.mocked(api), ApiError, setState, getState, refreshAll, loadServerState, saveProfile, OwnerUnknown, pendingOps }
}
const respond = (api: ReturnType<typeof vi.mocked<typeof import('../src/lib/api').api>>, state: unknown, importResult: () => unknown) =>
  api.mockImplementation((async (path: string) => (path === '/state' ? state : importResult())) as never)

beforeEach(() => {
  store.clear()
  who.sub = 'A'
})

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

  it('other_user_signing_in_does_not_get_previous_users_local_data_uploaded', async () => {
    const t = await load()
    t.setState({ ...local, ownerSub: 'A', soundOn: false })
    who.sub = 'B'
    respond(t.api, empty, () => imported)
    await t.refreshAll()
    expect(t.api.mock.calls.some((c) => c[0] === '/import')).toBe(false)
    expect(t.getState()).toMatchObject({ homeCity: null, bird: null, trip: null, stories: [], stamps: [], ownerSub: 'B', soundOn: false })
  })

  it('failed_import_hold_does_not_apply_to_a_different_user', async () => {
    const t = await load()
    t.setState({ ...local, ownerSub: 'A' })
    who.sub = 'B'
    respond(t.api, empty, () => {
      throw new Error('down')
    })
    await t.refreshAll()
    expect(t.getState()).toMatchObject({ homeCity: null, stories: [], ownerSub: 'B' }) // A's data is neither shown nor held
  })

  it('first_sign_in_claims_unowned_local_data_and_reconciles', async () => {
    const t = await load()
    t.setState({ ...local, ownerSub: null })
    respond(t.api, empty, () => imported)
    await t.refreshAll()
    expect(t.api.mock.calls.some((c) => c[0] === '/import')).toBe(true)
    expect(t.getState().ownerSub).toBe('A')
  })

  it('same_user_returning_keeps_local_data', async () => {
    const t = await load()
    t.setState({ ...local, ownerSub: 'A' })
    respond(t.api, empty, () => {
      throw new Error('down')
    })
    await t.refreshAll()
    expect(t.getState()).toMatchObject({ homeCity: city, stories: [story], ownerSub: 'A' })
  })

  it('partial_server_state_does_not_replace_local_data', async () => {
    const t = await load() // an earlier import died half way: items exist on the server but its profile is still null
    t.setState(local)
    respond(t.api, { ...empty, stories: [{ ...story, id: 'srv-only' }] }, () => {
      throw new Error('down')
    })
    await t.refreshAll()
    expect(t.getState().stories.map((x) => x.id)).toEqual(['s1'])
    expect(t.getState().homeCity).toEqual(city)
  })

  it('items_beyond_the_caps_stay_on_the_device_after_a_successful_import', async () => {
    const t = await load()
    const many = Array.from({ length: 2005 }, (_, i) => ({ ...story, id: `s${i}`, dateMs: 10_000 - i }))
    t.setState({ ...local, stories: many })
    t.api.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path === '/state') return empty
      const sent = JSON.parse(init!.body as string)
      expect(sent.stories).toHaveLength(2000)
      return { ...imported, stories: sent.stories }
    }) as never)
    await t.refreshAll()
    expect(t.getState().stories).toHaveLength(2005)
    expect(t.getState().stories.map((x) => x.id)).toEqual(many.map((x) => x.id)) // newest first, nothing lost
  })

  it('items_beyond_caps_survive_subsequent_polls', async () => {
    const t = await load()
    const many = Array.from({ length: 2005 }, (_, i) => ({ ...story, id: `s${i}`, dateMs: 10_000 - i }))
    t.setState({ ...local, stories: many })
    let server = empty as unknown
    t.api.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path === '/state') return server
      server = { ...imported, stories: JSON.parse(init!.body as string).stories }
      return server
    }) as never)
    await t.refreshAll()
    await t.refreshAll() // the next poll: the server only has the first 2000
    expect(t.getState().stories).toHaveLength(2005)
    const next = await load() // and on a later page load
    next.api.mockImplementation((async () => server) as never)
    await next.refreshAll()
    expect(next.getState().stories).toHaveLength(2005)
    expect(next.getState().stamps).toEqual([stamp]) // groups within the caps still take server state
  })

  it('failed_import_then_profile_created_does_not_wipe_local_data', async () => {
    const t = await load()
    t.setState(local)
    let server = empty as unknown
    t.api.mockImplementation((async (path: string) => {
      if (path === '/state') return server
      if (path === '/me') return void (server = { ...empty, profile: { ...imported.profile, homeCity: null, bird: null } }) // PUT /me makes a bare profile
      throw new t.ApiError(503)
    }) as never)
    await t.refreshAll() // import fails
    t.saveProfile()
    await vi.waitFor(() => expect(t.api.mock.calls.some((c) => c[0] === '/me')).toBe(true))
    await t.refreshAll() // the server now has a profile without the import
    expect(t.getState()).toMatchObject({ homeCity: city, bird: local.bird, stories: [story], stamps: [stamp], trip })
    const next = await load() // a later load still knows the import is pending, and retries it
    next.api.mockImplementation((async (path: string) => (path === '/state' ? server : imported)) as never)
    await next.refreshAll()
    expect(next.api.mock.calls.some((c) => c[0] === '/import')).toBe(true)
    expect(next.getState().inviteCode).toBe('ABCDEFGH')
  })

  it('import_retries_on_later_polls_until_it_succeeds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const t = await load()
      t.setState(local)
      let up = false
      let done = false
      t.api.mockImplementation((async (path: string) => {
        if (path === '/state') return done ? imported : empty
        if (!up) throw new t.ApiError(503)
        done = true
        return imported
      }) as never)
      await t.refreshAll()
      await t.refreshAll() // too soon: not retried
      expect(t.api.mock.calls.filter((c) => c[0] === '/import')).toHaveLength(1)
      vi.setSystemTime(Date.now() + 31_000)
      await t.refreshAll() // still down
      expect(t.api.mock.calls.filter((c) => c[0] === '/import')).toHaveLength(2)
      up = true
      vi.setSystemTime(Date.now() + 31_000)
      await t.refreshAll()
      expect(t.api.mock.calls.filter((c) => c[0] === '/import')).toHaveLength(3)
      expect(t.getState().inviteCode).toBe('ABCDEFGH')
      vi.setSystemTime(Date.now() + 31_000)
      await t.refreshAll() // done: never again
      expect(t.api.mock.calls.filter((c) => c[0] === '/import')).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('import_400_does_not_wipe_and_holds_groups', async () => {
    const t = await load()
    t.setState(local)
    const withProfile = { ...empty, profile: { ...imported.profile, homeCity: null, bird: null } }
    respond(t.api, empty, () => {
      throw new t.ApiError(400)
    })
    await t.refreshAll()
    const next = await load() // later: the server got a bare profile (PUT /me), the same data is not resent
    respond(next.api, withProfile, () => {
      throw new next.ApiError(400)
    })
    await next.refreshAll()
    expect(next.api.mock.calls.some((c) => c[0] === '/import')).toBe(false)
    expect(next.getState()).toMatchObject({ homeCity: city, bird: local.bird, stories: [story], stamps: [stamp], trip })
    // the local data changed: the import is tried again
    const third = await load()
    third.setState((s) => ({ stories: [{ ...story, id: 's2' }, ...s.stories] }))
    respond(third.api, withProfile, () => imported)
    await third.refreshAll()
    expect(third.api.mock.calls.some((c) => c[0] === '/import')).toBe(true)
    expect(third.getState().inviteCode).toBe('ABCDEFGH')
  })

  it('a_rejected_import_shows_an_error_once_and_is_not_retried', async () => {
    const t = await load()
    t.setState(local)
    respond(t.api, empty, () => {
      throw new t.ApiError(400)
    })
    await t.refreshAll()
    const { getSyncStatus } = await import('../src/lib/syncStatus')
    expect(getSyncStatus()).toMatchObject({ state: 'error', lastError: 'Some local data could not be uploaded' })
    expect(t.getState().stories).toEqual([story])
    const next = await load()
    respond(next.api, empty, () => imported)
    await next.refreshAll()
    expect(next.api.mock.calls.some((c) => c[0] === '/import')).toBe(false)
  })

  it('a_network_failure_leaves_the_status_offline_not_synced', async () => {
    const t = await load()
    t.setState(local)
    respond(t.api, empty, () => {
      throw new Error('down')
    })
    await t.refreshAll()
    const { getSyncStatus } = await import('../src/lib/syncStatus')
    expect(getSyncStatus().state).toBe('offline')
  })

  it('different_user_with_failing_first_state_fetch_gets_a_clean_device_and_no_upload', async () => {
    const t = await load()
    t.setState({ ...local, ownerSub: 'A' })
    who.sub = 'B'
    t.api.mockRejectedValue(new Error('offline'))
    await t.loadServerState().catch(() => undefined)
    expect(t.getState()).toMatchObject({ homeCity: null, bird: null, trip: null, stories: [], stamps: [], ownerSub: 'B' })
    t.saveProfile() // whatever B does next carries none of A's data
    await Promise.resolve()
    expect(t.api.mock.calls.some((c) => c[0] === '/import')).toBe(false)
    expect(JSON.stringify(t.api.mock.calls)).not.toContain('Zagreb')
    expect(JSON.stringify(t.api.mock.calls)).not.toContain('stork')
  })

  it('unknown_sub_blocks_local_writes_when_cognito_configured', async () => {
    const t = await load()
    t.setState({ ...local, ownerSub: 'A' })
    who.sub = null // token expired and the refresh needs the network
    await expect(t.loadServerState()).rejects.toBeInstanceOf(t.OwnerUnknown)
    t.saveProfile()
    expect(t.pendingOps()).toBe(0)
    expect(t.api).not.toHaveBeenCalled()
    expect(t.getState().stories).toEqual([story]) // untouched, just not used
  })

  it('later_polls_do_not_mark_synced_while_local_data_is_unuploaded', async () => {
    const t = await load()
    t.setState(local)
    respond(t.api, empty, () => {
      throw new Error('down')
    })
    await t.refreshAll()
    await t.refreshAll()
    const { getSyncStatus } = await import('../src/lib/syncStatus')
    expect(getSyncStatus().state).toBe('offline')
  })
})
