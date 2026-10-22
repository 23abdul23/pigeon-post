import { beforeEach, describe, expect, it, vi } from 'vitest'

const mgr = vi.hoisted(() => {
  vi.stubEnv('VITE_COGNITO_USER_POOL_ID', 'us-east-1_abc')
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'client')
  vi.stubEnv('VITE_COGNITO_DOMAIN', 'https://x.auth.us-east-1.amazoncognito.com')
  return { getUser: vi.fn(), signinRedirect: vi.fn(), signinCallback: vi.fn(), removeUser: vi.fn(), signinSilent: vi.fn() }
})
vi.mock('oidc-client-ts', () => ({ UserManager: class { constructor() { return mgr } }, WebStorageStateStore: class {} }))

const store = new Map<string, string>()
vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
vi.stubGlobal('localStorage', sessionStorage)
vi.stubGlobal('location', { origin: 'http://localhost:5173', assign: vi.fn() })

import { getIdToken, readReturnTo, signIn } from '../src/lib/auth'

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
})

describe('auth client', () => {
  it('getIdToken_returns_null_when_signed_out', async () => {
    mgr.getUser.mockResolvedValue(null)
    expect(await getIdToken()).toBeNull()
  })
  it('signIn_stores_returnTo_for_the_callback', async () => {
    await signIn('/journal')
    expect(readReturnTo()).toBe('/journal')
    expect(mgr.signinRedirect).toHaveBeenCalled()
  })
})
