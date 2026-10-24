import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/outbox', () => ({ send: vi.fn(), setOnRejected: vi.fn() }))
vi.mock('../src/lib/stories', () => ({
  buildStory: vi.fn(async (lat: number, lng: number, km: number) => ({ place: `P${Math.round(km)}`, country: 'Croatia', cc: 'HR', lens: 'Nature', text: 'Lakes.', birds: [], km, lat, lng })),
}))

import { send } from '../src/lib/outbox'
import { computeProgress, continueRun, landSession, recoverStranded, settleElapsedSlots, startSession, unreadCards } from '../src/lib/flight'
import { getState, setState, type Landing, type Trip } from '../src/lib/store'

const dest = { id: 'p', name: 'Tokyo', country: 'Japan', cc: 'JP', lat: 35.7, lng: 139.7 }
const trip: Trip = { id: 't1', dest, routeKm: 20000, route: [[48.85, 2.35], [35.7, 139.7]], progressKm: 0, status: 'OUTBOUND', legs: 0, letterIds: [] }
const MIN = 60000

beforeEach(() => {
  vi.mocked(send).mockResolvedValue(null)
  setState({ trip, stories: [], stamps: [], sessions: [], stopCards: [], landing: null, session: null })
})

describe('chained slots', () => {
  it('starts the next slot at the previous scheduled end, losing no time', () => {
    const start = Date.now() - 32 * MIN
    const landing: Landing = { storyId: 's', tripId: 't1', reason: 'completed', km: 2500, gainedKm: 2500, focusedMs: 25 * MIN, durationMin: 25, atMs: 1 }
    setState({ trip: { ...trip, progressKm: 2500 }, landing })
    continueRun(start + 25 * MIN)
    const s = getState().session!
    expect(s.startMs).toBe(start + 25 * MIN)
    expect(computeProgress(s, getState().trip!, start + 32 * MIN).km).toBeCloseTo(2500 + 700, 3)
  })

  it('catches up several elapsed slots: one stop card each, then a running slot', async () => {
    const now = Date.now()
    setState({ session: { tripId: 't1', startMs: now - 80 * MIN, durationMin: 25, baseKm: 0, heartbeatMs: now } })
    expect(await settleElapsedSlots()).toBe(3)
    const st = getState()
    expect(st.sessions).toHaveLength(3)
    expect(st.stopCards.map((c) => c.km)).toEqual([2500, 5000, 7500])
    expect(st.session!.startMs).toBe(now - 5 * MIN)
    expect(computeProgress(st.session!, st.trip!, now).elapsedMs).toBeCloseTo(5 * MIN, -2)
  })

  it('does not double-land when called twice', async () => {
    const now = Date.now()
    setState({ session: { tripId: 't1', startMs: now - 30 * MIN, durationMin: 25, baseKm: 0, heartbeatMs: now } })
    await Promise.all([settleElapsedSlots(), settleElapsedSlots()])
    expect(getState().sessions).toHaveLength(1)
    expect(getState().stopCards).toHaveLength(1)
    expect(await settleElapsedSlots()).toBe(0)
    expect(getState().sessions).toHaveLength(1)
  })

  it('records no stop and chains nothing on arrival', async () => {
    const now = Date.now()
    setState({ trip: { ...trip, routeKm: 2000 }, session: { tripId: 't1', startMs: now - 30 * MIN, durationMin: 25, baseKm: 0, heartbeatMs: now } })
    expect(await settleElapsedSlots()).toBe(0)
    expect(getState().stopCards).toEqual([])
    expect(getState().session).toBeNull()
    expect(getState().landing).toMatchObject({ reason: 'completed', km: 2000 })
  })

  it('continueRun stays null for early landings', () => {
    setState({ trip: { ...trip, progressKm: 900 }, landing: { storyId: 's', tripId: 't1', reason: 'ended', km: 900, gainedKm: 900, focusedMs: 1, durationMin: 25, atMs: 1 } })
    expect(continueRun(5)).toBeNull()
    expect(getState().session).toBeNull()
  })

  it('an end request during catch-up stops the chain and lands with the requested reason', async () => {
    const now = Date.now()
    setState({ session: { tripId: 't1', startMs: now - 80 * MIN, durationMin: 25, baseKm: 0, heartbeatMs: now } })
    const run = settleElapsedSlots()
    void landSession('ended') // the user taps Land here while the first slot is being landed
    expect(await run).toBe(0)
    expect(getState().session).toBeNull()
    expect(getState().landing).toMatchObject({ reason: 'ended' })
    expect(getState().stopCards).toEqual([])
    startSession(trip, 25) // a new flight clears the request
    expect(await settleElapsedSlots()).toBe(0)
    expect(getState().session).not.toBeNull()
  })

  it('recovers a stranded mid-journey landing from its scheduled end', () => {
    const atMs = Date.now() - 7 * MIN
    setState({ stories: [{ id: 's' } as never], trip: { ...trip, progressKm: 2500 }, landing: { storyId: 's', tripId: 't1', reason: 'completed', km: 2500, gainedKm: 2500, focusedMs: 25 * MIN, durationMin: 25, atMs } })
    expect(recoverStranded()).toBe(true)
    expect(getState().session!.startMs).toBe(atMs)
    expect(getState().stopCards).toMatchObject([{ tripId: 't1', storyId: 's' }])
  })

  it('shows only this trip cards with a story, and a new trip drops the others', () => {
    const cards = [
      { tripId: 't1', storyId: 'a', km: 1, gainedKm: 1 },
      { tripId: 't1', storyId: 'gone', km: 1, gainedKm: 1 },
      { tripId: 'other', storyId: 'a', km: 1, gainedKm: 1 },
    ]
    expect(unreadCards(cards, 't1', [{ id: 'a' }])).toEqual([cards[0]])
    setState({ stopCards: cards, stories: [{ id: 'a' } as never] })
    startSession({ ...trip, id: 't2' }, 25)
    expect(getState().stopCards).toEqual([])
  })
})
