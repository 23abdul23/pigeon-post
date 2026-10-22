import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/auth', () => ({ COGNITO_CONFIGURED: true, currentSub: vi.fn(), getUserSub: vi.fn() }))
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))
vi.mock('../src/lib/outbox', () => ({ send: vi.fn(), flush: vi.fn(async () => {}), pendingOps: vi.fn(() => 0), pendingTouches: vi.fn(() => new Set<string>()), touchedSince: vi.fn(() => new Set<string>()), writeSeq: vi.fn(() => 0), setOnFlushed: vi.fn(), setOnRejected: vi.fn(), GROUPS: ['profile', 'trip', 'stories', 'stamps', 'sessions', 'friends', 'letters'], enqueue: vi.fn() }))
vi.mock('../src/lib/stories', () => ({
  buildStory: vi.fn(async (lat: number, lng: number, km: number) => ({ place: 'Kyoto', country: 'Japan', cc: 'JP', lens: 'Nature', text: 'Moss.', birds: [], km, lat, lng })),
}))

import { api } from '../src/lib/api'
import { landSession } from '../src/lib/flight'
import { pendingOps, pendingTouches, send } from '../src/lib/outbox'
import { attachmentUrl, uploadAttachment, writeLetter } from '../src/lib/social'
import { getState, setState, type Letter, type Trip } from '../src/lib/store'
import { refreshAll } from '../src/lib/sync'

const sendMock = vi.mocked(send)
const apiMock = vi.mocked(api)
const letter = (over: Partial<Letter>): Letter => ({ id: 'x', fromId: 'me', fromName: 'Ann', fromCity: 'Zagreb', cc: 'HR', toId: 'bob', text: 'hi', attachments: [], status: 'CARRIED', dateMs: 1, ...over })
const dest = { id: 'p', name: 'Kyoto', country: 'JP', cc: 'JP', lat: 35, lng: 135 }
const trip: Trip = { id: 't1', dest, routeKm: 100, route: [[45, 15], [35, 135]], progressKm: 90, status: 'OUTBOUND', legs: 1, friendId: 'bob', letterIds: ['mine'] }

beforeEach(() => {
  sendMock.mockReset()
  apiMock.mockReset()
  vi.mocked(pendingOps).mockReturnValue(0)
  setState({ letters: [], friends: [], stories: [], stamps: [], sessions: [], landing: null, homeCity: { name: 'Zagreb', country: 'HR', cc: 'HR', lat: 45, lng: 15 } })
})

describe('letters on the client', () => {
  it('writeLetter_posts_to_letters_via_outbox_and_adopts_server_copy', async () => {
    let reply!: (r: unknown) => void
    sendMock.mockReturnValueOnce(new Promise((r) => (reply = r)))
    const att = { name: 'cv.pdf', size: 1000, type: 'application/pdf', key: 'letters/sub/k1' }
    const l = writeLetter({ toId: 'bob', text: 'Hello', attachments: [att], status: 'WAITING' })
    expect(getState().letters[0]).toMatchObject({ id: l.id, status: 'WAITING', fromId: 'me' })
    expect(sendMock).toHaveBeenCalledWith({
      id: `letter:${l.id}`,
      method: 'POST',
      path: '/letters',
      body: { id: l.id, toId: 'bob', text: 'Hello', status: 'WAITING', attachmentKeys: ['letters/sub/k1'], attachments: [{ name: 'cv.pdf', size: 1000, type: 'application/pdf' }] },
      touches: [`letter:${l.id}`],
    })
    reply({ ...l, fromName: 'Ann (server)', attachments: [att] })
    await vi.waitFor(() => expect(getState().letters[0].fromName).toBe('Ann (server)'))
  })

  it('landSession_with_cognito_invents_no_reply_and_adopts_delivered_and_pickedUp', async () => {
    const now = Date.now()
    setState({
      trip,
      friends: [{ id: 'bob', name: 'Bob', city: 'Kyoto', cc: 'JP', status: 'accepted', lat: 35, lng: 135 }],
      letters: [letter({ id: 'mine' })],
      session: { tripId: 't1', startMs: now - 5 * 60000, durationMin: 25, baseKm: 90 },
    })
    let reply!: (r: unknown) => void
    sendMock.mockReturnValueOnce(new Promise((r) => (reply = r)))
    await landSession('completed')
    expect(getState().letters).toHaveLength(1) // no simulated reply in production
    expect(getState().letters[0].status).toBe('DELIVERED') // optimistic: my letter is handed over
    const picked = letter({ id: 'reply', fromId: 'bob', toId: 'me', status: 'CARRIED' })
    reply({ trip: { ...trip, route: undefined, progressKm: 100, legs: 2, status: 'DELIVERED' }, story: getState().stories[0], delivered: [letter({ id: 'mine', status: 'DELIVERED' })], pickedUp: [picked] })
    await vi.waitFor(() => expect(getState().letters.map((l) => [l.id, l.status])).toEqual([['reply', 'CARRIED'], ['mine', 'DELIVERED']]))
  })

  it('uploadAttachment_presigns_then_puts_the_file_and_attachmentUrl_presigns_a_get', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    apiMock.mockResolvedValueOnce({ url: 'https://s3/put', key: 'letters/sub/k1' })
    const file = new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' })
    expect(await uploadAttachment(file)).toEqual({ name: 'cv.pdf', size: 4, type: 'application/pdf', key: 'letters/sub/k1' })
    expect(apiMock).toHaveBeenCalledWith('/uploads/presign', { method: 'POST', body: JSON.stringify({ contentType: 'application/pdf', size: 4 }) })
    expect(fetchMock).toHaveBeenCalledWith('https://s3/put', { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: file })

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
    apiMock.mockResolvedValueOnce({ url: 'https://s3/put', key: 'letters/sub/k2' })
    await expect(uploadAttachment(file)).rejects.toThrow()

    apiMock.mockResolvedValueOnce({ url: 'https://s3/get' })
    expect(await attachmentUrl({ name: 'a', size: 1, key: 'letters/sub/k1' })).toBe('https://s3/get')
    expect(apiMock).toHaveBeenLastCalledWith('/uploads/url?key=letters%2Fsub%2Fk1')
    expect(await attachmentUrl({ name: 'a', size: 1, dataUrl: 'data:x' })).toBe('data:x')
  })

  it('refreshAll_applies_letters_and_friends_and_skips_groups_with_pending_ops', async () => {
    setState({ trip, letters: [letter({ id: 'old' })] })
    const incoming = letter({ id: 'new', fromId: 'bob', toId: 'me', status: 'DELIVERED' })
    const friend = { id: 'bob', name: 'Bob', city: 'Kyoto', cc: 'JP', status: 'accepted' as const, lat: 35, lng: 135 }
    vi.mocked(pendingTouches).mockReturnValue(new Set(['letters', 'friends']))
    apiMock.mockResolvedValueOnce({ profile: { inviteCode: 'X' }, trip: null, stories: [], stamps: [], sessions: [], letters: [incoming], friends: [friend] })
    await refreshAll()
    expect(getState().letters.map((l) => l.id)).toEqual(['old']) // unsent local edits win
    expect(getState().friends).toEqual([])

    vi.mocked(pendingTouches).mockReturnValue(new Set())
    apiMock.mockResolvedValueOnce({ profile: { inviteCode: 'X' }, trip: null, stories: [], stamps: [], sessions: [], letters: [incoming], friends: [friend] })
    await refreshAll()
    expect(getState().letters).toEqual([incoming])
    expect(getState().friends).toEqual([friend])
    expect(getState().trip).toBeNull() // the trip group is the server's now; the active flight (session) is Task 4's
  })
})
