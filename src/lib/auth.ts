import { useEffect, useState } from 'react'
import { UserManager, WebStorageStateStore } from 'oidc-client-ts'

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

/** Current ID token; refreshes via the refresh token when expired. */
export async function getIdToken(): Promise<string | null> {
  let user = await um().getUser()
  if (user?.expired && user.refresh_token) user = await um().signinSilent().catch(() => null)
  return user && !user.expired ? (user.id_token ?? null) : null
}

export function useAuth(): { status: 'loading' | 'signedOut' | 'signedIn'; email?: string } {
  const [s, setS] = useState<{ status: 'loading' | 'signedOut' | 'signedIn'; email?: string }>({ status: 'loading' })
  useEffect(() => {
    if (!COGNITO_CONFIGURED) return setS({ status: 'signedOut' })
    um().getUser().then((u) => setS(u && !u.expired ? { status: 'signedIn', email: u.profile.email } : { status: 'signedOut' }))
  }, [])
  return s
}
