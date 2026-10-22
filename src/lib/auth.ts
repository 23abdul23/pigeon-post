import { useEffect, useState } from 'react'
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'

const env = import.meta.env
const POOL = env.VITE_COGNITO_USER_POOL_ID as string | undefined
const CLIENT = env.VITE_COGNITO_CLIENT_ID as string | undefined
const DOMAIN = env.VITE_COGNITO_DOMAIN as string | undefined // e.g. https://pigeon-post-123.auth.us-east-1.amazoncognito.com
const RETURN_KEY = 'pp:returnTo'

/** False in offline dev (no VITE_COGNITO_*): SignIn and Guard fall back to the local mock user. */
export const COGNITO_CONFIGURED = !!(POOL && CLIENT && DOMAIN)

let manager: UserManager | undefined
function um(): UserManager {
  return (manager ??= new UserManager({
    authority: `https://cognito-idp.${POOL!.split('_')[0]}.amazonaws.com/${POOL}`,
    client_id: CLIENT!,
    redirect_uri: `${location.origin}/auth/callback`,
    scope: 'openid email profile',
    response_type: 'code', // PKCE is on by default for code flow
    userStore: new WebStorageStateStore({ store: localStorage }),
  }))
}

export async function signIn(returnTo = '/home'): Promise<void> {
  sessionStorage.setItem(RETURN_KEY, returnTo)
  await um().signinRedirect()
}

export function readReturnTo(): string {
  return sessionStorage.getItem(RETURN_KEY) ?? '/home'
}

/** Finishes the code exchange on /auth/callback; returns where to go next. */
export async function completeSignIn(): Promise<string> {
  const user = await um().signinCallback()
  const to = readReturnTo()
  sessionStorage.removeItem(RETURN_KEY)
  return user ? to : '/signin'
}

export async function signOut(): Promise<void> {
  await um().removeUser()
  // Cognito's end-session endpoint is not in its OIDC metadata, so build the URL by hand.
  location.assign(`${DOMAIN}/logout?client_id=${CLIENT}&logout_uri=${encodeURIComponent(`${location.origin}/signin`)}`)
}

// Concurrent callers (parallel api() calls) share one refresh instead of each spending the refresh token.
let refreshing: Promise<User | null> | undefined

/** The stored user, refreshed via the refresh token when the ID token has expired; null if unusable. */
async function liveUser(): Promise<User | null> {
  if (!COGNITO_CONFIGURED) return null
  let user = await um().getUser()
  if (user?.expired && user.refresh_token)
    user = await (refreshing ??= um()
      .signinSilent()
      .catch(() => null)
      .finally(() => (refreshing = undefined)))
  return user && !user.expired ? user : null
}

export async function getIdToken(): Promise<string | null> {
  return (await liveUser())?.id_token ?? null
}

type AuthState = { status: 'loading' | 'signedOut' | 'signedIn'; email?: string }

export async function resolveAuth(): Promise<AuthState> {
  const u = await liveUser().catch(() => null)
  return u ? { status: 'signedIn', email: u.profile.email } : { status: 'signedOut' }
}

export function useAuth(): AuthState {
  const [s, setS] = useState<AuthState>({ status: 'loading' })
  useEffect(() => {
    resolveAuth().then(setS)
  }, [])
  return s
}
