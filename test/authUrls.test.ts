import { describe, expect, it } from 'vitest'
import { NATIVE_SCHEME, callbackUri, isAuthCallbackUrl, isSignOutUrl, signOutUri } from '../src/lib/authUrls'

const ORIGIN = 'https://pigeonpost.example'

describe('auth URL helpers', () => {
  it('callbackUri_native_uses_custom_scheme', () => {
    expect(NATIVE_SCHEME).toBe('app.pigeonpost')
    expect(callbackUri(true, ORIGIN)).toBe('app.pigeonpost://auth/callback')
  })

  it('callbackUri_web_uses_origin', () => {
    expect(callbackUri(false, ORIGIN)).toBe(`${ORIGIN}/auth/callback`)
  })

  it('signOutUri_native_and_web', () => {
    expect(signOutUri(true, ORIGIN)).toBe('app.pigeonpost://signin')
    expect(signOutUri(false, ORIGIN)).toBe(`${ORIGIN}/signin`)
  })

  it('isAuthCallbackUrl_true_for_code', () => {
    expect(isAuthCallbackUrl('app.pigeonpost://auth/callback?code=abc123')).toBe(true)
  })

  it('isAuthCallbackUrl_true_for_error', () => {
    expect(isAuthCallbackUrl('app.pigeonpost://auth/callback?error=access_denied')).toBe(true)
  })

  it('isAuthCallbackUrl_false_without_code_or_error', () => {
    expect(isAuthCallbackUrl('app.pigeonpost://auth/callback')).toBe(false)
    expect(isAuthCallbackUrl('app.pigeonpost://auth/callback?state=xyz')).toBe(false)
  })

  it('isAuthCallbackUrl_false_for_other_scheme_or_path', () => {
    expect(isAuthCallbackUrl('https://evil.example/auth/callback?code=x')).toBe(false)
    expect(isAuthCallbackUrl('app.pigeonpost://other?code=x')).toBe(false)
  })

  it('isAuthCallbackUrl_false_for_garbage_string', () => {
    expect(isAuthCallbackUrl('not a url at all')).toBe(false)
    expect(isAuthCallbackUrl('')).toBe(false)
  })
  it('isSignOutUrl_accepts_only_the_exact_signin_deep_link', () => {
    expect(isSignOutUrl('app.pigeonpost://signin')).toBe(true)
    for (const u of ['app.pigeonpost://signin/', 'app.pigeonpost://signin?x=1', 'app.pigeonpost://signinx', 'app.pigeonpost://auth/callback?code=1', 'https://x/signin', 'APP.PIGEONPOST://signin', '', 'garbage'])
      expect(isSignOutUrl(u)).toBe(false)
  })
})
