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

import { completeSignIn, getIdToken, readReturnTo, resolveAuth, signIn } from '../src/lib/auth'

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

  const fresh = { expired: false, id_token: 'new', profile: { email: 'a@b.c' } }
  const stale = (refresh_token?: string) => ({ expired: true, id_token: 'old', refresh_token, profile: { email: 'a@b.c' } })

  it('getIdToken_refreshes_expired_user_with_refresh_token', async () => {
    mgr.getUser.mockResolvedValue(stale('r'))
    mgr.signinSilent.mockResolvedValue(fresh)
    expect(await getIdToken()).toBe('new')
  })
  it('getIdToken_null_when_silent_refresh_fails', async () => {
    mgr.getUser.mockResolvedValue(stale('r'))
    mgr.signinSilent.mockRejectedValue(new Error('revoked'))
    expect(await getIdToken()).toBeNull()
  })
  it('getIdToken_null_when_expired_without_refresh_token', async () => {
    mgr.getUser.mockResolvedValue(stale())
    expect(await getIdToken()).toBeNull()
    expect(mgr.signinSilent).not.toHaveBeenCalled()
  })
  it('getIdToken_null_when_cognito_not_configured', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', '')
    const m = await import('../src/lib/auth')
    expect(await m.getIdToken()).toBeNull()
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'client')
  })

  it('completeSignIn_returns_stored_returnTo_and_clears_it', async () => {
    await signIn('/journal')
    mgr.signinCallback.mockResolvedValue(fresh)
    expect(await completeSignIn()).toBe('/journal')
    expect(readReturnTo()).toBe('/home')
  })
  it('completeSignIn_goes_to_signin_when_no_user', async () => {
    mgr.signinCallback.mockResolvedValue(undefined)
    expect(await completeSignIn()).toBe('/signin')
  })
  it('completeSignIn_rejects_when_exchange_fails', async () => {
    mgr.signinCallback.mockRejectedValue(new Error('bad code'))
    await expect(completeSignIn()).rejects.toThrow('bad code')
  })

  it('resolveAuth_signedIn_with_email', async () => {
    mgr.getUser.mockResolvedValue(fresh)
    expect(await resolveAuth()).toEqual({ status: 'signedIn', email: 'a@b.c' })
  })
  it('resolveAuth_refreshes_expired_session_instead_of_signing_out', async () => {
    mgr.getUser.mockResolvedValue(stale('r'))
    mgr.signinSilent.mockResolvedValue(fresh)
    expect(await resolveAuth()).toEqual({ status: 'signedIn', email: 'a@b.c' })
  })
  it('resolveAuth_signedOut_when_no_user_or_getUser_throws', async () => {
    mgr.getUser.mockResolvedValue(null)
    expect(await resolveAuth()).toEqual({ status: 'signedOut' })
    mgr.getUser.mockRejectedValue(new Error('storage'))
    expect(await resolveAuth()).toEqual({ status: 'signedOut' })
  })
})
