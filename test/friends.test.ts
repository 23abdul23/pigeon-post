import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/auth', () => ({ COGNITO_CONFIGURED: true, currentSub: vi.fn(), getUserSub: vi.fn().mockResolvedValue(null) }))
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

import { api, ApiError } from '../src/lib/api'
import { getState, hydrate, setState, type Friend } from '../src/lib/store'
import { acceptFriend, declineFriend, removeFriend, requestFriendByCode, settleRequests } from '../src/lib/social'

const apiMock = vi.mocked(api)
const bob: Friend = { id: 'b', name: 'Bob', city: 'Kyoto', cc: 'JP', lat: 35.01, lng: 135.77, status: 'pending_out' }
const empty = { trip: null, stories: [], letters: [], stamps: [], sessions: [] }

beforeEach(() => {
  apiMock.mockReset()
  store.clear()
  setState({ friends: [] })
})

describe('friends (client)', () => {
  it('hydrate_takes_friends_and_invite_code_from_server', () => {
    hydrate({ ...empty, friends: [bob], profile: { inviteCode: 'ABCDEFGH' } })
    expect(getState().friends).toEqual([bob])
    expect(getState().inviteCode).toBe('ABCDEFGH')
  })

  it('request_by_code_posts_and_adds_the_returned_friend_without_auto_accepting', async () => {
    vi.useFakeTimers()
    apiMock.mockResolvedValue(bob)
    await requestFriendByCode('bbbb-bbbb')
    expect(apiMock).toHaveBeenCalledWith('/friends/request', { method: 'POST', body: JSON.stringify({ code: 'bbbb-bbbb' }) })
    await vi.advanceTimersByTimeAsync(10_000)
    settleRequests()
    expect(getState().friends).toEqual([bob]) // still pending: only the other user can accept
    vi.useRealTimers()
  })

  it('request_by_code_turns_errors_into_readable_messages', async () => {
    apiMock.mockRejectedValue(new ApiError(404))
    await expect(requestFriendByCode('ZZZZZZZZ')).rejects.toThrow(/doesn't match anyone/)
    apiMock.mockRejectedValue(new ApiError(400))
    await expect(requestFriendByCode('MINE')).rejects.toThrow(/own code|profile/i)
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(requestFriendByCode('X')).rejects.toThrow(/offline|connection/i)
    expect(getState().friends).toEqual([])
  })

  it('accept_decline_remove_update_locally_and_call_distinct_ops', async () => {
    apiMock.mockResolvedValue(undefined)
    setState({ friends: [{ ...bob, status: 'pending_in' }, { ...bob, id: 'c', status: 'pending_in' }, { ...bob, id: 'd', status: 'accepted' }] })
    acceptFriend('b')
    declineFriend('c')
    removeFriend('d')
    expect(getState().friends.map((f) => [f.id, f.status])).toEqual([['b', 'accepted']])
    await vi.waitFor(() => expect(apiMock.mock.calls.map(([p, i]) => `${i?.method} ${p}`)).toEqual(['POST /friends/b/accept', 'POST /friends/c/decline', 'DELETE /friends/d']))
  })
})
