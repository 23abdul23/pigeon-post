import { describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

import { api } from '../src/lib/api'
import { getState, hydrate, setState } from '../src/lib/store'
import { loadServerState } from '../src/lib/sync'
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

  it('loadServerState_is_a_noop_without_cognito', async () => {
    await loadServerState()
    expect(api).not.toHaveBeenCalled()
  })
})
