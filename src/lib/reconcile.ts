import { api, ApiError } from './api'
import { clearOutbox, pendingTouches } from './outbox'
import { getState, hydrate, claimOwner, setState, type ServerState, type State } from './store'
import { setSyncStatus } from './syncStatus'
import { withRoute } from './trips'

// Mirror the server's caps (api/src/lib/constants.ts; a test asserts they match). Older items beyond them stay on this device.
const MAX_STORIES = 2000
const MAX_STAMPS = 400
const MAX_SESSIONS = 5000
const MAX_BODY = 4_194_304
/** the server writes up to ~7400 items, ten at a time */
const IMPORT_TIMEOUT_MS = 30_000
/** a failed import is retried on later polls, at most this often */
const RETRY_MS = 30_000

/** True when this device holds data a brand-new server account does not (the condition for `reconcileLocal`). */
export const hasLocalData = (s: State = getState()): boolean => !!(s.homeCity || s.bird || s.trip || s.stories.length || s.stamps.length)

/**
 * Called with the signed-in sub before anything is hydrated or uploaded. Claims unowned local data for this user, or, when the
 * data belongs to another account, wipes it (with its pending import) and the previous user's queued writes. Returns false
 * after a wipe: nothing local is this user's, so there is nothing to import or hold.
 */
export function claimLocalData(sub: string): boolean {
  if (claimOwner(sub) === 'own') return true
  clearOutbox()
  return false
}

const GROUPS = ['stories', 'sessions', 'stamps'] as const

function importBody(s: State) {
  const { route: _route, ...trip } = s.trip ?? ({} as never)
  const body = {
    profile: { ...(s.user?.name && { name: s.user.name }), ...(s.homeCity && { homeCity: s.homeCity }), ...(s.bird && { bird: s.bird }), settings: s.settings },
    ...(s.trip && { trip }),
    stories: s.stories.slice(0, MAX_STORIES), // newest first
    stamps: s.stamps.slice(0, MAX_STAMPS),
    sessions: s.sessions.slice(0, MAX_SESSIONS),
  }
  // the server refuses bigger bodies: drop the oldest stories, a tenth at a time, until it fits
  let text = JSON.stringify(body)
  while (text.length > MAX_BODY && body.stories.length) {
    body.stories = body.stories.slice(0, Math.floor(body.stories.length * 0.9))
    text = JSON.stringify(body)
  }
  return { body, text, over: GROUPS.filter((g) => body[g].length < s[g].length) }
}

const hash = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = Math.imul(h, 33) ^ text.charCodeAt(i)
  return (h >>> 0).toString(36)
}

let lastTry = -Infinity

/**
 * While `importPending`, uploads this device's local data (`POST /import`) and hydrates from the reply. Sent directly, not
 * through the outbox: it needs the reply. Called only from the (single-flight) state pull; tries at most once per 30 s, the
 * first call of a page load at once. 200 and 409 ("already imported") clear the flag. Any other failure keeps it and every
 * local item, so a later poll or load tries again; a 400 is reported once and the same data is not resent until it changes.
 * The server lets its own fields win and skips invalid items. Returns true when it hydrated from the reply.
 * Groups with more items than the caps keep their extra (oldest) items on this device and are held from then on (`importOverCap`).
 */
export async function reconcileLocal(): Promise<boolean> {
  const before = getState()
  if (!before.importPending || Date.now() - lastTry < RETRY_MS) return false
  const { body, text, over } = importBody(before)
  const sig = hash(text)
  if (before.importRejected === sig) return false // refused before: already reported
  lastTry = Date.now()
  let reply: ServerState
  try {
    reply = await api<ServerState>('/import', { method: 'POST', body: text }, IMPORT_TIMEOUT_MS)
  } catch (e) {
    console.warn('Could not import local data', e)
    if (e instanceof ApiError && e.status === 409) {
      setState({ importPending: false }) // another device (or a try whose reply was lost) imported first
      return false
    }
    if (e instanceof ApiError && e.status === 400) {
      setState({ importRejected: sig })
      setSyncStatus({ state: 'error', lastError: 'Some local data could not be uploaded' })
    } else setSyncStatus({ state: 'offline' })
    return false
  }
  if (!Array.isArray(reply?.stories)) return false // not a ServerState: keep everything local
  hydrate({ ...reply, trip: reply.trip && withRoute(reply.trip, reply.profile?.homeCity) }, pendingTouches())
  const left = <T>(all: T[], sent: T[]) => all.filter((x) => !sent.includes(x))
  const extra = { stories: left(before.stories, body.stories), sessions: left(before.sessions, body.sessions), stamps: left(before.stamps, body.stamps) }
  setState({ importPending: false, importRejected: null, importOverCap: over })
  if (over.length) {
    setState((st) => ({
      stories: [...st.stories, ...extra.stories.filter((x) => !st.stories.some((y) => y.id === x.id))].sort((a, b) => b.dateMs - a.dateMs),
      sessions: [...st.sessions, ...extra.sessions.filter((x) => !st.sessions.some((y) => y.id === x.id))].sort((a, b) => b.endMs - a.endMs),
      stamps: [...st.stamps, ...extra.stamps.filter((x) => !st.stamps.some((y) => y.cc === x.cc))].sort((a, b) => a.firstMs - b.firstMs),
    }))
    // ponytail: the extra items are never uploaded; a later version with higher caps (or a chunked import) would have to send them
    setSyncStatus({ state: 'error', lastError: 'Some older items are too many to upload; they stay on this device' })
  }
  return true
}
