import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

import { api, ApiError } from '../src/lib/api'
import { enqueue, flush } from '../src/lib/outbox'

const apiMock = vi.mocked(api)
const sent = () => apiMock.mock.calls.map(([path]) => path)
const queued = () => JSON.parse(store.get('pigeon-post:outbox') ?? '[]').map((o: { id: string }) => o.id)

beforeEach(() => {
  vi.useFakeTimers()
  apiMock.mockReset()
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
})
