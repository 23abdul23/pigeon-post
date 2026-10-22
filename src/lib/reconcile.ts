import { api, ApiError } from './api'
import { clearOutbox, pendingTouches } from './outbox'
import { getState, hydrate, claimOwner, setState, type ServerState, type State } from './store'
import { setSyncStatus } from './syncStatus'
import { withRoute } from './trips'

// Mirror the server's caps (api/src/handlers/import.ts); older items are the ones left behind, and they stay on this device.
const MAX_STORIES = 200
const MAX_STAMPS = 300
const MAX_SESSIONS = 500
const MAX_BODY = 250_000
const REJECTED_KEY = 'pigeon-post:import-rejected'

/** True when this device holds data a brand-new server account does not (the condition for `reconcileLocal`). */
export const hasLocalData = (s: State = getState()): boolean => !!(s.homeCity || s.bird || s.trip || s.stories.length || s.stamps.length)

/**
 * Called with the signed-in sub before anything is hydrated or uploaded. Claims unowned local data for this user, or, when the
 * data belongs to another account, wipes it and the previous user's queued writes. Returns false after a wipe: nothing local
 * is this user's, so there is nothing to import or hold.
 */
export function claimLocalData(sub: string): boolean {
  if (claimOwner(sub) === 'own') return true
  clearOutbox()
  try {
    localStorage.removeItem(REJECTED_KEY)
  } catch {
    // ignore
  }
  return false
}

let failed = false
/** True when the last `reconcileLocal()` returned false because the upload failed (offline, 5xx, rejected), not because it was already imported. */
export const importFailed = () => failed

function importBody(s: State) {
  const { route: _route, ...trip } = s.trip ?? ({} as never)
  const body = {
    profile: { ...(s.user?.name && { name: s.user.name }), ...(s.homeCity && { homeCity: s.homeCity }), ...(s.bird && { bird: s.bird }), settings: s.settings },
    ...(s.trip && { trip }),
    stories: s.stories.slice(0, MAX_STORIES), // newest first
    stamps: s.stamps.slice(0, MAX_STAMPS),
    sessions: s.sessions.slice(0, MAX_SESSIONS),
  }
  // the server refuses bodies over 256 KB: drop the oldest stories until it fits
  while (JSON.stringify(body).length > MAX_BODY && body.stories.length) body.stories.pop()
  return body
}

/**
 * Uploads this device's pre-existing local data (`POST /import`) when the server has no profile yet, and hydrates from the reply.
 * Sent directly, not through the outbox: it needs the reply, and 409 means "already imported". Returns true once imported;
 * false on any failure (409, offline, 5xx, rejected) with all local data untouched, so the next page load tries again
 * (except a 400, which is reported once and not retried: the same data would be rejected again).
 * Local stories/sessions/stamps beyond the upload caps stay on the device, merged under the server's items.
 */
export async function reconcileLocal(): Promise<boolean> {
  failed = false
  try {
    if (localStorage.getItem(REJECTED_KEY)) return false // rejected before: already reported, not retried
  } catch {
    // ignore
  }
  const before = getState()
  const body = importBody(before)
  let reply: ServerState
  try {
    reply = await api<ServerState>('/import', { method: 'POST', body: JSON.stringify(body) })
  } catch (e) {
    console.warn('Could not import local data', e)
    if (e instanceof ApiError && e.status === 409) return false
    failed = true
    if (e instanceof ApiError && e.status === 400) {
      try {
        localStorage.setItem(REJECTED_KEY, '1')
      } catch {
        // ignore
      }
      setSyncStatus({ state: 'error', lastError: 'Some local data could not be uploaded' })
    } else setSyncStatus({ state: 'offline' })
    return false
  }
  if (!Array.isArray(reply?.stories)) {
    failed = true // not a ServerState: keep everything local
    return false
  }
  hydrate({ ...reply, trip: reply.trip && withRoute(reply.trip, reply.profile?.homeCity) }, pendingTouches())
  const left = <T>(all: T[], sent: T[]) => all.filter((x) => !sent.includes(x))
  const extra = { stories: left(before.stories, body.stories), sessions: left(before.sessions, body.sessions), stamps: left(before.stamps, body.stamps) }
  if (extra.stories.length || extra.sessions.length || extra.stamps.length) {
    setState((st) => ({
      stories: [...st.stories, ...extra.stories.filter((x) => !st.stories.some((y) => y.id === x.id))].sort((a, b) => b.dateMs - a.dateMs),
      sessions: [...st.sessions, ...extra.sessions.filter((x) => !st.sessions.some((y) => y.id === x.id))].sort((a, b) => b.endMs - a.endMs),
      stamps: [...st.stamps, ...extra.stamps.filter((x) => !st.stamps.some((y) => y.cc === x.cc))].sort((a, b) => a.firstMs - b.firstMs),
    }))
  }
  return true
}
