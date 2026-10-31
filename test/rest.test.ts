import { describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/outbox', () => ({ send: vi.fn(async () => null), setOnRejected: vi.fn() }))
vi.mock('../src/lib/stories', () => ({
  buildStory: vi.fn(async (lat: number, lng: number, km: number) => ({ place: 'Plitvice', country: 'Croatia', cc: 'HR', lens: 'Nature', text: 'Lakes.', birds: [], km, lat, lng })),
}))

import { restHere } from '../src/lib/rest'
import { getState, setState, type Trip } from '../src/lib/store'

const dest = { id: 'p', name: 'Split', country: 'Croatia', cc: 'HR', lat: 43.5, lng: 16.44 }
const trip: Trip = { id: 't1', dest, routeKm: 10000, route: [[45.81, 15.98], [43.5, 16.44]], progressKm: 0, status: 'OUTBOUND', legs: 0, letterIds: [] }

describe('restHere', () => {
  it('lands where the bird is and queues that place’s card', async () => {
    setState({ trip, stories: [], stamps: [], sessions: [], stopCards: [], session: { tripId: 't1', startMs: Date.now() - 5 * 60000, durationMin: 25, baseKm: 0 } })
    const l = (await restHere())!
    expect(getState().session).toBeNull()
    expect(getState().landing).toMatchObject({ reason: 'ended', storyId: l.storyId })
    expect(getState().stopCards).toEqual([expect.objectContaining({ tripId: 't1', storyId: l.storyId })])
    expect(getState().stories[0]).toMatchObject({ id: l.storyId, place: 'Plitvice' })
  })

  it('does nothing when no flight is running', async () => {
    setState({ session: null, landing: null, stopCards: [] })
    expect(await restHere()).toBeNull()
    expect(getState().stopCards).toEqual([])
  })
})
