import { describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/outbox', () => ({ send: vi.fn() }))
vi.mock('../src/lib/stories', () => ({
  buildStory: vi.fn(async (lat: number, lng: number, km: number) => ({ place: 'Plitvice', country: 'Croatia', cc: 'HR', lens: 'Nature', text: 'Lakes.', birds: [], km, lat, lng })),
}))

import { send } from '../src/lib/outbox'
import { landSession, startReturn } from '../src/lib/flight'
import { getState, setState, type Trip } from '../src/lib/store'

const sendMock = vi.mocked(send)
const dest = { id: 'p', name: 'Split', country: 'Croatia', cc: 'HR', lat: 43.5, lng: 16.44 }
const trip: Trip = { id: 't1', dest, routeKm: 10000, route: [[45.81, 15.98], [43.5, 16.44]], progressKm: 0, status: 'OUTBOUND', legs: 0, letterIds: [] }

describe('landSession', () => {
  it('landSession_sends_session_and_adopts_server_result', async () => {
    const now = Date.now()
    setState({ trip, stories: [], stamps: [], sessions: [], session: { tripId: 't1', startMs: now - 5 * 60000, durationMin: 25, baseKm: 0 } })
    let reply!: (r: unknown) => void
    sendMock.mockReturnValueOnce(new Promise((r) => (reply = r)))
    const landing = (await landSession('ended'))!

    // the local optimistic result is visible straight away
    expect(getState().stories[0].id).toBe(landing.storyId)
    const [op] = sendMock.mock.calls[0]
    expect(op).toMatchObject({ id: `session:${getState().sessions[0].id}`, method: 'POST', path: '/trips/t1/sessions', touches: ['trip', 'stories', 'stamps', 'sessions', 'letters'] })
    expect(op.body).toMatchObject({ id: getState().sessions[0].id, reason: 'ended', story: { id: landing.storyId, cc: 'HR' } })

    const serverStory = { ...getState().stories[0], lat: 45.12, lng: 15.5 }
    reply({ trip: { ...trip, route: undefined, progressKm: 480, legs: 1 }, stamp: { cc: 'HR', country: 'Croatia', firstMs: 5, visits: 1 }, story: serverStory, delivered: [], pickedUp: [] })
    await vi.waitFor(() => expect(getState().trip!.progressKm).toBe(480))
    expect(getState().trip!.route).toEqual(trip.route) // kept: the server stores none
    expect(getState().stamps).toEqual([{ cc: 'HR', country: 'Croatia', firstMs: 5, visits: 1 }])
    expect(getState().stories[0]).toMatchObject({ lat: 45.12, lng: 15.5 })
  })

  it('startReturn_posts_return_with_its_own_op_id', () => {
    sendMock.mockResolvedValue(null)
    setState({ trip: { ...trip, status: 'DELIVERED', progressKm: 10000 } })
    startReturn()
    expect(sendMock).toHaveBeenCalledWith({ id: 'return:t1', method: 'POST', path: '/trips/t1/return', touches: ['trip'] })
    expect(getState().trip).toMatchObject({ status: 'RETURNING', progressKm: 0 })
    expect(sendMock).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'flight:t1', path: '/flight' }), expect.any(Function)) // after the return
  })
})
