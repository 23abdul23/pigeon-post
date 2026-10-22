import { useEffect, useState } from 'react'
import { api } from './api'
import { COGNITO_CONFIGURED } from './auth'
import { clearOutbox, enqueue, flush, pendingOps } from './outbox'
import { getState, hydrate, resetState, setState, type Profile, type ServerState } from './store'
import { withRoute } from './trips'

/** Pulls `GET /state` into the store. No-op without Cognito (offline dev keeps its local state). */
export async function loadServerState(): Promise<void> {
  if (!COGNITO_CONFIGURED) return
  await flush()
  if (pendingOps()) return // unsent local edits win until they reach the server
  const s = await api<ServerState>('/state')
  hydrate({ ...s, trip: s.trip && withRoute(s.trip, s.profile?.homeCity) })
}

/**
 * The 30 s mail poll: takes only letters and friends from `GET /state`, so a running flight (trip, session, landing) is never
 * overwritten. Skipped while local writes are unsent, before and after the fetch (a letter written meanwhile wins).
 */
export async function refreshMail(): Promise<void> {
  if (!COGNITO_CONFIGURED || pendingOps()) return
  const s = await api<ServerState>('/state')
  if (pendingOps()) return
  setState({ letters: s.letters, friends: s.friends })
}

const POLL_MS = 30_000
/** Polls mail every 30 s while the tab is visible and the user is signed in (and once on becoming visible again). */
export function useMailPoll(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn || !COGNITO_CONFIGURED) return
    const tick = () => document.visibilityState === 'visible' && refreshMail().catch((e) => console.warn('mail poll failed', e))
    const id = window.setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [signedIn])
}

/** Saves the local profile with `PUT /me` through the outbox (retried if offline). */
export function saveProfile(): void {
  if (!COGNITO_CONFIGURED) return
  const s = getState()
  const body: Partial<Profile> = { settings: s.settings }
  if (s.user?.name) body.name = s.user.name
  if (s.homeCity) body.homeCity = s.homeCity
  if (s.bird) body.bird = s.bird
  enqueue({ id: 'me', method: 'PUT', path: '/me', body })
  void flush()
}

let loading: Promise<void> | undefined
let loaded = !COGNITO_CONFIGURED

/** Loads server state once per page load after sign-in; true once done (or failed, falling back to local state). */
export function useServerSync(signedIn: boolean): boolean {
  const [ready, setReady] = useState(loaded)
  useEffect(() => {
    if (!signedIn) return
    let live = true
    ;(loading ??= loadServerState()
      .catch((e) => console.warn('Could not load server state; using local state', e))
      .finally(() => (loaded = true))).then(() => live && setReady(true))
    return () => {
      live = false
    }
  }, [signedIn])
  return ready
}

/** `DELETE /me` sent directly (never queued), then this device forgets the account. Throws, keeping everything, if the server did not delete. */
export async function deleteAccount(): Promise<void> {
  if (COGNITO_CONFIGURED) await api('/me', { method: 'DELETE' })
  clearOutbox()
  resetState()
}
