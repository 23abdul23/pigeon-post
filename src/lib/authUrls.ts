// Redirect URIs for OAuth sign-in. Native (Capacitor Android) uses the app's custom scheme so the browser
// hands the callback back to the app; web keeps using the page origin. These are pure string helpers.

export const NATIVE_SCHEME = 'app.pigeonpost'

/** Where the identity provider sends the user after sign-in. */
export function callbackUri(native: boolean, origin: string): string {
  return native ? `${NATIVE_SCHEME}://auth/callback` : `${origin}/auth/callback`
}

/** Where the user lands after sign-out. */
export function signOutUri(native: boolean, origin: string): string {
  return native ? `${NATIVE_SCHEME}://signin` : `${origin}/signin`
}

/** True only for the native sign-in callback that carries a `code` or `error` parameter. Never throws. */
export function isAuthCallbackUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== `${NATIVE_SCHEME}:` || u.host !== 'auth' || u.pathname !== '/callback') return false
    return u.searchParams.has('code') || u.searchParams.has('error')
  } catch {
    return false
  }
}

/** True only for the exact native sign-out deep link (Cognito's logout_uri), so the app can finish signing out. */
export function isSignOutUrl(url: string): boolean {
  return url === signOutUri(true, '')
}
