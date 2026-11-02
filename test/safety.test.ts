import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/auth', () => ({ COGNITO_CONFIGURED: true, currentSub: vi.fn(), getUserSub: vi.fn().mockResolvedValue(null) }))
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

import { api } from '../src/lib/api'
import { clearOutbox } from '../src/lib/outbox'
import { getState, setState, type Letter } from '../src/lib/store'
import { blockUser, blockedPeople, canContinueSignIn, isHiddenLetter, reportContent, unblockUser, unreadCount, visibleLetters } from '../src/lib/safety'

const apiMock = vi.mocked(api)
const queued = () => JSON.parse(store.get('pigeon-post:outbox') ?? '[]') as { path: string; method: string; body?: unknown }[]
const letter = (id: string, fromId: string, toId = 'me'): Letter => ({ id, fromId, fromName: fromId, fromCity: 'X', cc: 'JP', toId, text: '', attachments: [], status: 'DELIVERED', dateMs: 1 })

beforeEach(() => {
  vi.useRealTimers()
  apiMock.mockReset()
  clearOutbox()
  store.clear()
  setState({ blockedIds: [], blockedNames: {}, friends: [{ id: 'b', name: 'Bob', city: 'Kyoto', cc: 'JP', lat: 0, lng: 0, status: 'accepted' }] })
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

  it('unblockUser_removes_the_id_and_queues_the_delete', async () => {
    vi.useFakeTimers()
    setState({ blockedIds: ['b', 'c'], blockedNames: { b: 'Bob', c: 'Cy' } })
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await unblockUser('b')
    expect(getState().blockedIds).toEqual(['c'])
    expect(getState().blockedNames).toEqual({ c: 'Cy' })
    expect(queued().map((o) => `${o.method} ${o.path}`)).toEqual(['DELETE /blocks/b'])
  })

  it('offline_block_then_unblock_resolves_to_the_last_intent', async () => {
    vi.useFakeTimers()
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await blockUser('b')
    await unblockUser('b')
    expect(queued().map((o) => `${o.method} ${o.path}`)).toEqual(['DELETE /blocks/b'])
    expect(getState().blockedIds).toEqual([])
  })

  it('blocked_people_list_uses_the_stored_name_or_the_fallback', () => {
    expect(blockedPeople(['b', 'z'], { b: 'Bob' })).toEqual([
      { id: 'b', name: 'Bob' },
      { id: 'z', name: 'Blocked traveler' },
    ])
  })

  it('blockUser_stores_the_name_snapshot', async () => {
    vi.useFakeTimers()
    apiMock.mockResolvedValue(undefined)
    await blockUser('b')
    expect(getState().blockedNames).toEqual({ b: 'Bob' })
  })

  it('visibleLetters_filters_by_sender_id', () => {
    const ls = [letter('1', 'b'), letter('2', 'c')]
    expect(visibleLetters(ls, ['c']).map((l) => l.id)).toEqual(['1'])
  })

  it('unread_count_ignores_letters_from_blocked_senders', () => {
    const ls = [letter('1', 'b'), letter('2', 'c'), { ...letter('3', 'c'), status: 'OPENED' as const }]
    expect(unreadCount(ls, [])).toBe(2)
    expect(unreadCount(ls, ['b'])).toBe(1)
  })

  it('a_letter_from_a_blocked_sender_is_reported_as_hidden', () => {
    expect(isHiddenLetter(letter('1', 'b'), ['b'])).toBe(true)
    expect(isHiddenLetter(letter('1', 'b'), ['c'])).toBe(false)
  })
})
