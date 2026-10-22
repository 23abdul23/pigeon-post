import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.mock('../src/lib/auth', () => ({ COGNITO_CONFIGURED: true, currentSub: vi.fn(), getUserSub: vi.fn().mockResolvedValue(null) }))
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

import { api, ApiError } from '../src/lib/api'
import { enqueue, pendingOps } from '../src/lib/outbox'
import { getState, setState } from '../src/lib/store'
import { deleteAccount } from '../src/lib/sync'

const apiMock = vi.mocked(api)
const city = { name: 'Zagreb', country: 'Croatia', cc: 'HR', lat: 45.81, lng: 15.98 }

beforeEach(() => {
  apiMock.mockReset()
  store.clear()
  setState({ homeCity: city })
})

describe('deleteAccount', () => {
  it('delete_account_calls_delete_me_then_clears_local_state', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(503)).mockResolvedValue(undefined)
    enqueue({ id: 'me', method: 'PUT', path: '/me', body: {}, touches: ['profile'] })
    // a failed delete keeps everything, so the user can try again
    await expect(deleteAccount()).rejects.toThrow()
    expect(getState().homeCity).toEqual(city)
    expect(apiMock).toHaveBeenCalledWith('/me', { method: 'DELETE' })

    await deleteAccount()
    expect(getState().homeCity).toBeNull()
    expect(pendingOps()).toBe(0)
  })
})
