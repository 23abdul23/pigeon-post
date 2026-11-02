import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/auth', () => ({ COGNITO_CONFIGURED: true, currentSub: vi.fn(), getUserSub: vi.fn().mockResolvedValue(null) }))
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

import { api } from '../src/lib/api'
import { getState, setState, type Letter } from '../src/lib/store'
import { blockUser, canContinueSignIn, reportContent, visibleLetters } from '../src/lib/safety'

const apiMock = vi.mocked(api)
const queued = () => JSON.parse(store.get('pigeon-post:outbox') ?? '[]') as { path: string; method: string; body?: unknown }[]
const letter = (id: string, fromId: string, toId = 'me'): Letter => ({ id, fromId, fromName: fromId, fromCity: 'X', cc: 'JP', toId, text: '', attachments: [], status: 'DELIVERED', dateMs: 1 })

beforeEach(() => {
  vi.useRealTimers()
  apiMock.mockReset()
  store.clear()
  setState({ blockedIds: [], friends: [{ id: 'b', name: 'Bob', city: 'Kyoto', cc: 'JP', lat: 0, lng: 0, status: 'accepted' }] })
})

describe('safety', () => {
  it('canContinueSignIn_requires_both_boxes', () => {
    expect(canContinueSignIn({ ageConfirmed: true, termsAccepted: true })).toBe(true)
    expect(canContinueSignIn({ ageConfirmed: true, termsAccepted: false })).toBe(false)
    expect(canContinueSignIn({ ageConfirmed: false, termsAccepted: true })).toBe(false)
    expect(canContinueSignIn({ ageConfirmed: false, termsAccepted: false })).toBe(false)
  })

  it('blockUser_updates_store_immediately', async () => {
    let answer!: () => void
    apiMock.mockReturnValue(new Promise<undefined>((r) => (answer = () => r(undefined)))) // server has not answered yet
    const done = blockUser('b')
    expect(getState().blockedIds).toEqual(['b'])
    expect(getState().friends).toEqual([]) // blocking ends the friendship
    answer()
    await done
  })

  it('blockUser_queues_when_offline_and_flushes_later', async () => {
    vi.useFakeTimers()
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await blockUser('b')
    expect(getState().blockedIds).toEqual(['b'])
    expect(queued().map((o) => `${o.method} ${o.path}`)).toEqual(['POST /blocks/b'])
    apiMock.mockReset().mockResolvedValue(undefined)
    await vi.advanceTimersByTimeAsync(1000) // the backoff retry
    expect(apiMock).toHaveBeenCalledWith('/blocks/b', { method: 'POST' })
    expect(queued()).toEqual([])
  })

  it('blockedIds_hide_that_users_letters_in_the_mailbox_selector', () => {
    const ls = [letter('1', 'b'), letter('2', 'c'), letter('3', 'me', 'b'), letter('4', 'me', 'c')]
    expect(visibleLetters(ls, []).map((l) => l.id)).toEqual(['1', '2', '3', '4'])
    expect(visibleLetters(ls, ['b']).map((l) => l.id)).toEqual(['2', '4'])
  })

  it('reportContent_posts_the_expected_body', async () => {
    apiMock.mockResolvedValue(undefined)
    const r = { targetId: 'b', kind: 'letter', reason: 'spam', note: 'ads', letterId: 'L1' } as const
    await reportContent(r)
    expect(apiMock).toHaveBeenCalledWith('/reports', { method: 'POST', body: JSON.stringify(r) })
  })

  it('reportContent_failure_is_queued_not_lost', async () => {
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await reportContent({ targetId: 'b', kind: 'user', reason: 'harassment' })
    expect(queued().map((o) => o.path)).toEqual(['/reports'])
    expect(queued()[0].body).toEqual({ targetId: 'b', kind: 'user', reason: 'harassment' })
  })
})
