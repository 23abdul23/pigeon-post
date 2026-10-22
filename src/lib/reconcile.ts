import { api } from './api'
import { getState, hydrate, type ServerState, type State } from './store'
import { withRoute } from './trips'

// Mirror the server's caps (api/src/handlers/import.ts); older items are the ones left behind, and they stay on this device.
const MAX_STORIES = 200
const MAX_STAMPS = 300
const MAX_SESSIONS = 500
const MAX_BODY = 250_000

/** True when this device holds data a brand-new server account does not (the condition for `reconcileLocal`). */
export const hasLocalData = (s: State = getState()): boolean => !!(s.homeCity || s.bird || s.trip || s.stories.length || s.stamps.length)

function importBody(s: State): string {
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
  return JSON.stringify(body)
}

/**
 * Uploads this device's pre-existing local data (`POST /import`) when the server has no profile yet, and hydrates from the reply.
 * Sent directly, not through the outbox: it needs the reply, and 409 means "already imported". Returns true once imported;
 * false on any failure (409, offline, 5xx) with all local data untouched, so the next page load tries again.
 */
export async function reconcileLocal(): Promise<boolean> {
  let reply: ServerState
  try {
    reply = await api<ServerState>('/import', { method: 'POST', body: importBody(getState()) })
  } catch (e) {
    console.warn('Could not import local data', e)
    return false
  }
  if (!Array.isArray(reply?.stories)) return false // not a ServerState: keep everything local
  hydrate({ ...reply, trip: reply.trip && withRoute(reply.trip, reply.profile?.homeCity) })
  return true
}
