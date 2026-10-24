import { COGNITO_CONFIGURED } from './auth'
import { DEMO_MODE } from './demo'
import type { ApiError } from './api'
import { deviceId, serverNow } from './device'
import { FLIGHT_STALE_MS, KM_PER_FOCUS_MINUTE, pointAtKm, wrapLng } from './geo'
import { send, setOnRejected } from './outbox'
import { replyFrom } from './social'
import { buildStory } from './stories'
import { getState, setState, type ActiveFlight, type ActiveSession, type Landing, type Letter, type SessionResult, type Trip } from './store'

export type Progress = { km: number; remainingMs: number; elapsedMs: number; done: boolean; arrived: boolean }

/** Clock-based progress: nothing is counted tick by tick, so throttled tabs cannot drift. */
export function computeProgress(s: ActiveSession, trip: Trip, nowMs: number): Progress {
  const total = s.durationMin * 60000
  const elapsedMs = Math.min(total, Math.max(0, (s.leftAtMs ?? nowMs) - s.startMs))
  const km = Math.min(trip.routeKm, s.baseKm + (elapsedMs / 60000) * KM_PER_FOCUS_MINUTE)
  return { km, elapsedMs, remainingMs: total - elapsedMs, done: elapsedMs >= total, arrived: km >= trip.routeKm }
}

/** A UUID-shaped id from a stable 128-bit hash (cyrb128) of `seed`: the same on every device and run. */
function stableId(seed: string): string {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  const hex = [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Session and story ids of a flight: two devices landing the same flight post the same ids, so the server replays one landing. */
export const flightIds = (f: { tripId: string; startMs: number }) => ({ sessionId: stableId(`${f.tripId}:${f.startMs}`), storyId: stableId(`story:${f.tripId}:${f.startMs}`) })

const fresh = (f: ActiveFlight) => serverNow() - f.heartbeatMs <= FLIGHT_STALE_MS

/** owner: this device flies it; observer: another device flies it (fresh heartbeat); none: free to start (a stale foreign flight counts as none). */
export function flightRole(): 'owner' | 'observer' | 'none' {
  const { session, flight } = getState()
  if (session) return 'owner' // a refresh or a 409 clears it when another device owns the flight
  return flight && flight.deviceId !== deviceId() && fresh(flight) ? 'observer' : 'none'
}

const refreshSoon = () => void import('./sync').then((m) => m.refreshAll()).catch((e) => console.warn('refresh after flight rejection failed', e))

/**
 * A `PUT /flight` the server refused for good, sent directly or from the outbox queue (an offline start meeting another
 * device's flight on reconnect): 409 `{ flight }` means another device owns it (become observer); 409 "already landed" or
 * 404 means it is over (drop it and refresh). True when handled.
 */
function flightRejected(body: { tripId: string; startMs: number }, e: ApiError): boolean {
  const mine = () => getState().session?.startMs === body.startMs && getState().session?.tripId === body.tripId
  const other = (e.body as { flight?: ActiveFlight } | undefined)?.flight
  if (e.status === 409 && other) {
    setState({ flight: other, ...(mine() ? { session: null } : {}) })
    return true
  }
  if (e.status === 409 || e.status === 404) {
    if (mine()) setState({ session: null, flight: null })
    refreshSoon()
    return true
  }
  console.error('PUT /flight rejected', e, body) // 400: a client bug
  return false
}
/** 409 "session already recorded": the server has this session (from POST /import) without a stored reply; nothing to redo or show. */
const sessionRecorded = (e: ApiError) => e.status === 409 && (e.body as { error?: string } | undefined)?.error === 'session already recorded'
setOnRejected((op, e) =>
  op.method === 'PUT' && op.path === '/flight' ? flightRejected(op.body as { tripId: string; startMs: number }, e) : op.path.endsWith('/sessions') && sessionRecorded(e),
)

/**
 * `PUT /flight` for the local session, through `send` so it reaches the server after the trip it needs (POST /trips) and is
 * queued on a network error or 5xx. A 4xx, now or when the queued PUT is sent later, goes to `flightRejected`.
 */
function putFlight(s: ActiveSession, takeover = false): Promise<void> {
  const body = {
    tripId: s.tripId,
    startMs: s.startMs,
    durationMin: s.durationMin,
    baseKm: s.baseKm,
    legs: s.legs ?? getState().trip?.legs ?? 0,
    deviceId: deviceId(),
    ...(s.leftAtMs === undefined ? {} : { leftAtMs: s.leftAtMs }),
    ...(takeover ? { takeover: true } : {}),
  }
  const mine = () => getState().session?.startMs === s.startMs && getState().session?.tripId === s.tripId
  return send<ActiveFlight>({ id: `flight:${s.tripId}`, method: 'PUT', path: '/flight', body, touches: ['flight'] }, (e) => flightRejected(body, e)).then((f) => {
    if (f && mine()) setState({ flight: f })
  })
}

export function startSession(trip: Trip, durationMin: number) {
  const now = serverNow()
  const session: ActiveSession = { tripId: trip.id, startMs: now, durationMin, baseKm: trip.progressKm, legs: trip.legs, heartbeatMs: now }
  setState({ session, landing: null })
  void putFlight(session)
}

/** After a completed slot short of the destination: flies the next slot of the same length from the trip's progress. */
export function continueRun(): Trip | null {
  const { landing, trip } = getState()
  if (!trip || landing?.reason !== 'completed' || landing.tripId !== trip.id || trip.progressKm >= trip.routeKm) return null
  startSession(trip, landing.durationMin)
  return trip
}

/** Back on the tab: unfreezes the flight where `markLeft` stopped it, as if the time away had not passed. */
export function resumeFlight(): void {
  const s = getState().session
  if (!s || s.leftAtMs === undefined) return
  const { leftAtMs, ...rest } = s
  const now = serverNow()
  const next: ActiveSession = { ...rest, startMs: s.startMs + (now - leftAtMs), heartbeatMs: now }
  setState({ session: next })
  void putFlight(next)
}

/** Tells the server this device still flies (every 30 s from the Focus screen, and once on leaving the tab with `leftAtMs`). */
export function heartbeat(): void {
  const s = getState().session
  if (s) void putFlight(s)
}

/** Leaving the tab: freezes the flight at this moment and tells the server (the 30 s heartbeat stops while hidden). */
export function markLeft(): void {
  const s = getState().session
  if (!s || s.leftAtMs) return
  setState({ session: { ...s, leftAtMs: serverNow() } })
  heartbeat()
}

/**
 * Lands a flight this device left (tab back, or reopened), but only if it still owns it: a refresh first, so a device
 * that was taken over meanwhile becomes the observer instead of landing the other device's flight short. Offline, the
 * refresh fails, or hangs past `waitMs` (fetch has no timeout), and it lands as before.
 */
export async function landIfStillOwner(reason: Landing['reason'], waitMs = 4000): Promise<Landing | null> {
  const s = getState().session
  if (!s) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const { refreshAll } = await import('./sync')
    await Promise.race([refreshAll(), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('refresh timed out')), waitMs)))])
  } catch (e) {
    console.warn('refresh before landing failed; landing anyway', e)
  } finally {
    clearTimeout(timer)
  }
  const cur = getState().session
  if (!cur || cur.tripId !== s.tripId || cur.startMs !== s.startMs || flightRole() === 'observer') return null
  return landSession(reason)
}

/** Continues the flight another device is flying: same start, distance and length; this device owns it from now on. */
export async function takeOver(): Promise<void> {
  const { flight: f, trip } = getState()
  if (!f || !trip || trip.id !== f.tripId) return
  const session: ActiveSession = { tripId: f.tripId, startMs: f.startMs, durationMin: f.durationMin, baseKm: f.baseKm, legs: f.legs ?? trip.legs, heartbeatMs: serverNow() }
  setState({ session, landing: null })
  await putFlight(session, true)
}

/** After delivering at a friend's city, the same route flown backwards brings the bird home. */
export function startReturn(durationMin = 25): Trip | null {
  const t = getState().trip
  if (!t) return null
  const back: Trip = { ...t, route: [...t.route].reverse(), progressKm: 0, status: 'RETURNING' }
  setState({ trip: back })
  void send({ id: `return:${t.id}`, method: 'POST', path: `/trips/${t.id}/return`, touches: ['trip'] })
  startSession(back, durationMin)
  return back
}

/** Replaces letters by id and adds new ones (picked up on arrival) at the top. */
const upsert = (letters: Letter[], next: Letter[]) => {
  const byId = new Map(next.map((l) => [l.id, l]))
  return [...next.filter((l) => !letters.some((x) => x.id === l.id)), ...letters.map((l) => byId.get(l.id) ?? l)]
}

/** The server's word on a landed session (the local result stays if the call failed and was queued). */
function adoptSession(r: SessionResult, sent: Trip) {
  const stamp = r.stamp
  setState((st) => ({
    letters: upsert(st.letters, [...r.delivered, ...r.pickedUp]),
    // the server keeps no route, so keep ours; and leave the trip alone if it moved on meanwhile (e.g. already flying home)
    trip: st.trip === sent ? { ...sent, ...r.trip, route: sent.route } : st.trip,
    stories: st.stories.map((x) => (x.id === r.story.id ? { ...r.story, saved: x.saved } : x)),
    stamps: !stamp ? st.stamps : st.stamps.some((x) => x.cc === stamp.cc) ? st.stamps.map((x) => (x.cc === stamp.cc ? stamp : x)) : [...st.stamps, stamp],
  }))
}

let landing: Promise<Landing | null> | null = null

/**
 * Ends the running session: updates the trip, records the session, writes the story and stamp.
 * Safe to call twice (second tab, double click): the second call returns the first result.
 */
export function landSession(reason: Landing['reason']): Promise<Landing | null> {
  if (landing) return landing
  landing = (async () => {
    const st = getState()
    const s = st.session
    const trip = st.trip
    if (!s || !trip || trip.id !== s.tripId) return st.landing
    const now = serverNow()
    const endMs = reason === 'left' && s.leftAtMs ? s.leftAtMs : now
    const p = computeProgress({ ...s, leftAtMs: s.leftAtMs ?? endMs }, trip, endMs)
    const spot = pointAtKm(trip.route, p.km).pt
    const story = await buildStory(spot[0], wrapLng(spot[1]), p.km) // routes carry unwrapped longitudes
    const { storyId: id, sessionId } = flightIds(s)
    const cur = getState()
    const stampKnown = cur.stamps.some((x) => x.cc === story.cc)
    const arrived = p.arrived
    let status: Trip['status'] = trip.status
    let letters = cur.letters
    const offlineDemo = DEMO_MODE && !COGNITO_CONFIGURED
    if (arrived && trip.status === 'RETURNING') {
      // home again: the replies the bird carried are ready to open (with the API, its reply says which ones this bird carried)
      if (offlineDemo) letters = letters.map((l) => (l.toId === 'me' && l.status === 'CARRIED' ? { ...l, status: 'DELIVERED' as const } : l))
      status = 'DONE'
    } else if (arrived && trip.friendId) {
      // at the friend's city: hand over my letters and load their reply
      letters = letters.map((l) => (l.fromId === 'me' && l.toId === trip.friendId && l.status === 'CARRIED' ? { ...l, status: 'DELIVERED' as const } : l))
      const friend = cur.friends.find((f) => f.id === trip.friendId)
      // a real friend's reply only exists if they wrote one; the API returns it in `pickedUp`
      if (friend && offlineDemo) letters = [replyFrom(friend), ...letters]
      status = 'DELIVERED'
    } else if (arrived) {
      status = 'DONE'
    }
    const nextTrip: Trip = { ...trip, progressKm: p.km, legs: trip.legs + 1, status }
    const result: Landing = {
      storyId: id,
      tripId: trip.id,
      reason,
      km: p.km,
      gainedKm: p.km - s.baseKm,
      focusedMs: p.elapsedMs,
      durationMin: s.durationMin,
      atMs: endMs,
      newStampCc: stampKnown ? undefined : story.cc,
    }
    setState({
      letters,
      trip: nextTrip,
      session: null,
      flight: null, // the landing transaction deletes it on the server
      landing: result,
      stories: [{ ...story, id, dateMs: now, saved: false }, ...cur.stories],
      sessions: [{ id: sessionId, tripId: trip.id, startMs: s.startMs, endMs, km: p.km - s.baseKm, reason }, ...cur.sessions],
      stamps: stampKnown
        ? cur.stamps.map((x) => (x.cc === story.cc ? { ...x, visits: x.visits + 1 } : x))
        : [...cur.stamps, { cc: story.cc, country: story.country, firstMs: now, visits: 1 }],
    })
    const body = { id: sessionId, startMs: s.startMs, endMs, reason, kmGained: p.km - s.baseKm, story: { ...story, id } }
    void send<SessionResult>({ id: `session:${sessionId}`, method: 'POST', path: `/trips/${trip.id}/sessions`, body, touches: ['trip', 'stories', 'stamps', 'sessions', 'letters'] }, sessionRecorded).then((r) => r && adoptSession(r, nextTrip))
    return result
  })().finally(() => {
    landing = null
  })
  return landing
}
