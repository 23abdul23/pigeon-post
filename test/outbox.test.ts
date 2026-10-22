import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/auth', () => ({ COGNITO_CONFIGURED: true, currentSub: vi.fn(), getUserSub: vi.fn() }))
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

import { api, ApiError } from '../src/lib/api'
import { currentSub, getUserSub } from '../src/lib/auth'
import { enqueue, flush, send } from '../src/lib/outbox'

const apiMock = vi.mocked(api)
const sent = () => apiMock.mock.calls.map(([path]) => path)
const queued = () => JSON.parse(store.get('pigeon-post:outbox') ?? '[]').map((o: { id: string }) => o.id)

beforeEach(() => {
  vi.useFakeTimers()
  apiMock.mockReset()
  vi.mocked(currentSub).mockReset()
  vi.mocked(getUserSub).mockReset().mockResolvedValue(null) // async like the real one
})
afterEach(async () => {
  apiMock.mockResolvedValue(undefined)
  await vi.runAllTimersAsync() // drain anything left so tests stay independent
  vi.useRealTimers()
})

describe('outbox', () => {
  it('outbox_retries_after_network_error_and_keeps_order', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(undefined)
    enqueue({ id: 'a', method: 'PUT', path: '/a', body: { n: 1 } })
    enqueue({ id: 'b', method: 'PUT', path: '/b' })
    await flush()
    expect(sent()).toEqual(['/a'])
    expect(queued()).toEqual(['a', 'b']) // kept, still in order, persisted
    await vi.advanceTimersByTimeAsync(1000) // backoff retry
    expect(sent()).toEqual(['/a', '/a', '/b'])
    expect(apiMock.mock.calls[0][1]).toEqual({ method: 'PUT', body: '{"n":1}' })
    expect(queued()).toEqual([])
  })

  it('outbox_drops_op_on_400', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(400)).mockResolvedValue(undefined)
    enqueue({ id: 'bad', method: 'PUT', path: '/bad' })
    enqueue({ id: 'good', method: 'PUT', path: '/good' })
    await flush()
    expect(sent()).toEqual(['/bad', '/good'])
    expect(queued()).toEqual([])
  })

  it('outbox_keeps_op_on_5xx_and_does_not_run_concurrently', async () => {
    let release!: () => void
    apiMock.mockImplementationOnce(() => new Promise((r) => (release = () => r(undefined))))
    enqueue({ id: 'a', method: 'PUT', path: '/a' })
    const p1 = flush()
    const p2 = flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(sent()).toEqual(['/a']) // second flush joined the first
    release()
    await Promise.all([p1, p2])
    apiMock.mockRejectedValueOnce(new ApiError(503))
    enqueue({ id: 'b', method: 'PUT', path: '/b' })
    await flush()
    expect(queued()).toEqual(['b'])
  })

  it('outbox_is_discarded_when_a_different_user_signs_in', async () => {
    apiMock.mockResolvedValue(undefined)
    vi.mocked(currentSub).mockReturnValue('user-a')
    enqueue({ id: 'me', method: 'PUT', path: '/me', body: { name: 'A' } })
    expect(JSON.parse(store.get('pigeon-post:outbox')!)[0].owner).toBe('user-a')
    vi.mocked(getUserSub).mockResolvedValue('user-b') // A's session lapsed, B signed in
    await flush()
    expect(apiMock).not.toHaveBeenCalled()
    expect(queued()).toEqual([])

    vi.mocked(currentSub).mockReturnValue('user-b')
    enqueue({ id: 'me', method: 'PUT', path: '/me', body: { name: 'B' } })
    await flush()
    expect(sent()).toEqual(['/me']) // the owner's own ops still go out
  })

  it('outbox_flush_survives_a_failing_getUserSub', async () => {
    vi.mocked(getUserSub).mockRejectedValue(new Error('storage broken'))
    apiMock.mockResolvedValue(undefined)
    enqueue({ id: 'a', method: 'PUT', path: '/a' })
    await expect(flush()).resolves.toBeUndefined()
    expect(sent()).toEqual(['/a'])
  })

  it('send_returns_reply_or_queues_and_keeps_order', async () => {
    apiMock.mockResolvedValueOnce({ ok: 1 })
    expect(await send({ id: 'trip:t', method: 'POST', path: '/trips' })).toEqual({ ok: 1 })
    expect(queued()).toEqual([])

    apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await send({ id: 'session:s', method: 'POST', path: '/trips/t/sessions' })).toBeNull()
    expect(queued()).toEqual(['session:s'])
    // something is still queued: a later write waits behind it instead of overtaking
    expect(await send({ id: 'return:t', method: 'POST', path: '/trips/t/return' })).toBeNull()
    expect(queued()).toEqual(['session:s', 'return:t'])
    apiMock.mockResolvedValue(undefined)
    await vi.advanceTimersByTimeAsync(2000)
    expect(sent().slice(-2)).toEqual(['/trips/t/sessions', '/trips/t/return'])
    expect(queued()).toEqual([])

    apiMock.mockRejectedValueOnce(new ApiError(404))
    expect(await send({ id: 'story-save:x', method: 'PUT', path: '/stories/x' })).toBeNull()
    expect(queued()).toEqual([]) // the server will never accept it: not queued
  })
})
