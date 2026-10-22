import { useEffect, useState } from 'react'
import { api } from './api'
import { COGNITO_CONFIGURED } from './auth'
import { clearOutbox, enqueue, flush, pendingOps, pendingTouches } from './outbox'
import { getSyncStatus, markSynced, setSyncStatus } from './syncStatus'
import { getState, hydrate, resetState, type Profile, type ServerState } from './store'
import { withRoute } from './trips'

const GROUPS = ['profile', 'trip', 'stories', 'stamps', 'sessions', 'friends', 'letters']

/**
 * Fetches `GET /state` and applies every entity group without a pending local write (checked before and after the fetch,
 * so a write made meanwhile wins). Never touches the active flight (`session`) or `landing`. No-op without Cognito.
 */
async function pull(): Promise<void> {
  if (!COGNITO_CONFIGURED) return
  const before = pendingTouches()
  if (GROUPS.every((g) => before.has(g))) return
  const prev = getSyncStatus().state
  if (prev !== 'error') setSyncStatus({ state: 'syncing', pending: pendingOps() })
  let s: ServerState
  try {
    s = await api<ServerState>('/state')
  } catch (e) {
    if (prev !== 'error') setSyncStatus({ state: 'offline', pending: pendingOps() })
    throw e
  }
  const held = new Set([...before, ...pendingTouches()])
  hydrate({ ...s, trip: s.trip && withRoute(s.trip, s.profile?.homeCity ?? (held.has('profile') ? getState().homeCity : null)) }, held)
  if (prev === 'error') setSyncStatus({ pending: pendingOps() }) // a dropped write stays visible until the user retries
  else if (pendingOps()) setSyncStatus({ state: 'offline', pending: pendingOps() })
  else markSynced()
}

/** Sign-in load: sends queued writes first, then takes every group that has no write still pending. */
export async function loadServerState(): Promise<void> {
  if (!COGNITO_CONFIGURED) return
  await flush()
  await pull()
}

/** The 30 s poll and tab-visible refresh: server state for every entity group without a pending local write. */
export const refreshAll = pull

/** The Header chip's tap: clears a shown error, sends what is queued, then refreshes. */
export async function retrySync(): Promise<void> {
  if (!COGNITO_CONFIGURED) return
  setSyncStatus({ state: 'syncing', lastError: undefined, pending: pendingOps() })
  await flush()
  await pull().catch((e) => console.warn('retry refresh failed', e))
}

const POLL_MS = 30_000
/** Polls server state every 30 s while the tab is visible and the user is signed in (and once on becoming visible again). */
export function useStatePoll(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn || !COGNITO_CONFIGURED) return
    const tick = () => document.visibilityState === 'visible' && refreshAll().catch((e) => console.warn('state poll failed', e))
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
  enqueue({ id: 'me', method: 'PUT', path: '/me', body, touches: ['profile'] })
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

export { useSyncStatus, type SyncStatus } from './syncStatus'
