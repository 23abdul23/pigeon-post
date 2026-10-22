import { useEffect, useState } from 'react'
import { api } from './api'
import { COGNITO_CONFIGURED } from './auth'
import { clearOutbox, enqueue, flush, GROUPS, pendingOps, pendingTouches, setOnFlushed, touchedSince, writeSeq } from './outbox'
import { getSyncStatus, markSynced, setSyncStatus } from './syncStatus'
import { getState, hydrate, resetState, type Profile, type ServerState } from './store'
import { withRoute } from './trips'

/**
 * Fetches `GET /state` and applies every entity group without a local write pending now, pending when the fetch started,
 * or started/settled during the fetch (the response may predate it). Never touches the active flight (`session`) or
 * `landing`. `show` makes the chip say "Syncing…" (initial load, retry); background polls stay quiet. No-op without Cognito.
 */
async function pull(show: boolean): Promise<void> {
  if (!COGNITO_CONFIGURED) return
  const before = pendingTouches()
  if (GROUPS.every((g) => before.has(g))) return
  const since = writeSeq()
  const prev = getSyncStatus().state
  if (show && prev !== 'error') setSyncStatus({ state: 'syncing', pending: pendingOps() })
  let s: ServerState
  try {
    s = await api<ServerState>('/state')
  } catch (e) {
    if (prev !== 'error') setSyncStatus({ state: 'offline', pending: pendingOps() })
    throw e
  }
  try {
    const held = new Set([...before, ...pendingTouches(), ...touchedSince(since)])
    hydrate({ ...s, trip: s.trip && withRoute(s.trip, s.profile?.homeCity ?? (held.has('profile') ? getState().homeCity : null)) }, held)
  } catch (e) {
    setSyncStatus({ state: 'error', pending: pendingOps(), lastError: `Could not read server data: ${e instanceof Error ? e.message : 'unknown error'}` })
    throw e
  }
  const state = getSyncStatus().state
  if (pendingOps() || state === 'error') setSyncStatus({ pending: pendingOps() }) // a dropped write stays visible until the user retries
  else markSynced()
}

// One fetch at a time: concurrent callers share it, so an older response can never land after a newer one.
let pulling: Promise<void> | undefined
const pullOnce = (show: boolean) => (pulling ??= pull(show).finally(() => (pulling = undefined)))

/** Sign-in load: sends queued writes first, then takes every group that has no write still pending. */
export async function loadServerState(): Promise<void> {
  if (!COGNITO_CONFIGURED) return
  await flush()
  await pullOnce(true)
}

/** The poll, tab-visible and after-flush refresh: server state for every entity group without a pending local write. */
export const refreshAll = () => pullOnce(false)

// A flush that sent something and left nothing queued refreshes (refreshing never enqueues, so this cannot loop).
setOnFlushed(() => void refreshAll().catch((e) => console.warn('refresh after flush failed', e)))

/** The Header chip's tap: clears a shown error, sends what is queued, then refreshes. */
export async function retrySync(): Promise<void> {
  if (!COGNITO_CONFIGURED) return
  setSyncStatus({ state: 'syncing', lastError: undefined, pending: pendingOps() })
  await flush()
  await pullOnce(true).catch((e) => console.warn('retry refresh failed', e))
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
