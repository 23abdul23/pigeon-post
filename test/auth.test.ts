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

import { completeNativeSignIn, completeSignIn, getIdToken, readReturnTo, resolveAuth, signIn, signOut } from '../src/lib/auth'

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
  it('getIdToken_shares_one_refresh_between_concurrent_calls', async () => {
    mgr.getUser.mockResolvedValue(stale('r'))
    mgr.signinSilent.mockResolvedValue(fresh)
    expect(await Promise.all([getIdToken(), getIdToken(), getIdToken()])).toEqual(['new', 'new', 'new'])
    expect(mgr.signinSilent).toHaveBeenCalledTimes(1)
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
    mgr.getUser.mockResolvedValue(fresh) // a valid user: only the guard can make this null
    vi.resetModules()
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', '')
    try {
      const m = await import('../src/lib/auth')
      expect(await m.getIdToken()).toBeNull()
      expect(mgr.getUser).not.toHaveBeenCalled()
      expect(mgr.signinSilent).not.toHaveBeenCalled()
    } finally {
      vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'client')
    }
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

  it('completeNativeSignIn_passes_the_url_to_signinCallback_and_returns_returnTo', async () => {
    await signIn('/journal')
    mgr.signinCallback.mockResolvedValue(fresh)
    const url = 'app.pigeonpost://auth/callback?code=c&state=s'
    expect(await completeNativeSignIn(url)).toBe('/journal')
    expect(mgr.signinCallback).toHaveBeenCalledWith(url)
    expect(readReturnTo()).toBe('/home')
  })

  it('resolveAuth_signedIn_with_email', async () => {
    mgr.getUser.mockResolvedValue(fresh)
    expect(await resolveAuth()).toEqual({ status: 'signedIn', email: 'a@b.c' })
  })
  it('resolveAuth_includes_google_picture_claim', async () => {
    const pic = 'https://lh3.googleusercontent.com/a/x'
    mgr.getUser.mockResolvedValue({ ...fresh, profile: { email: 'a@b.c', picture: pic } })
    expect(await resolveAuth()).toEqual({ status: 'signedIn', email: 'a@b.c', picture: pic })
    mgr.getUser.mockResolvedValue(fresh)
    expect((await resolveAuth()).picture).toBeUndefined()
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

  const LOGOUT_NATIVE = 'https://x.auth.us-east-1.amazoncognito.com/logout?client_id=client&logout_uri=app.pigeonpost%3A%2F%2Fsignin'
  const LOGOUT_WEB = 'https://x.auth.us-east-1.amazoncognito.com/logout?client_id=client&logout_uri=http%3A%2F%2Flocalhost%3A5173%2Fsignin'
  const signOutDeps = (native: boolean, log: string[]) => ({
    native,
    assign: vi.fn((u: string) => void log.push(`assign:${u}`)),
    openBrowser: vi.fn(async (u: string) => void log.push(`open:${u}`)),
    go: vi.fn((to: string) => void log.push(`go:${to}`)),
  })

  it('native_signOut_opens_the_logout_url_in_the_browser_and_does_not_assign_location', async () => {
    const log: string[] = []
    mgr.removeUser.mockImplementation(async () => void log.push('removeUser'))
    const d = signOutDeps(true, log)
    await signOut(d)
    expect(log).toEqual(['removeUser', 'go:/signin', `open:${LOGOUT_NATIVE}`])
    expect(d.assign).not.toHaveBeenCalled()
  })
  it('native_signOut_still_lands_on_signin_when_the_browser_fails_to_open', async () => {
    const log: string[] = []
    const d = signOutDeps(true, log)
    d.openBrowser.mockRejectedValueOnce(new Error('no browser'))
    await expect(signOut(d)).resolves.toBeUndefined()
    expect(d.go).toHaveBeenCalledWith('/signin')
  })
  it('web_signOut_removes_the_user_and_assigns_the_logout_url', async () => {
    const log: string[] = []
    mgr.removeUser.mockImplementation(async () => void log.push('removeUser'))
    const d = signOutDeps(false, log)
    await signOut(d)
    expect(log).toEqual(['removeUser', `assign:${LOGOUT_WEB}`])
    expect(d.openBrowser).not.toHaveBeenCalled()
    expect(d.go).not.toHaveBeenCalled()
  })
})
