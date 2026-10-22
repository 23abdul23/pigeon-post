import { describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

import { api } from '../src/lib/api'
import { getState, hydrate, setState } from '../src/lib/store'
import { loadServerState } from '../src/lib/sync'

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
    setState({ homeCity: city, bird: { species: 'stork', name: 'Pip' }, stories: [{ id: 'keep' } as never] })
    hydrate({ ...empty, profile: null })
    expect(getState().homeCity).toBeNull()
    expect(getState().bird).toBeNull()
    expect(getState().stories).toHaveLength(1) // not server-owned yet: left alone
  })

  it('loadServerState_is_a_noop_without_cognito', async () => {
    await loadServerState()
    expect(api).not.toHaveBeenCalled()
  })
})
