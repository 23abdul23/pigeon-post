import { KM_PER_FOCUS_MINUTE, pointAtKm } from './geo'
import { replyFrom } from './social'
import { buildStory } from './stories'
import { getState, setState, type ActiveSession, type Landing, type Trip } from './store'

export type Progress = { km: number; remainingMs: number; elapsedMs: number; done: boolean; arrived: boolean }

/** Clock-based progress: nothing is counted tick by tick, so throttled tabs cannot drift. */
export function computeProgress(s: ActiveSession, trip: Trip, nowMs: number): Progress {
  const total = s.durationMin * 60000
  const elapsedMs = Math.min(total, Math.max(0, (s.leftAtMs ?? nowMs) - s.startMs))
  const km = Math.min(trip.routeKm, s.baseKm + (elapsedMs / 60000) * KM_PER_FOCUS_MINUTE)
  return { km, elapsedMs, remainingMs: total - elapsedMs, done: elapsedMs >= total, arrived: km >= trip.routeKm }
}

export function startSession(trip: Trip, durationMin: number) {
  setState({
    session: { tripId: trip.id, startMs: Date.now(), durationMin, baseKm: trip.progressKm, heartbeatMs: Date.now() },
    landing: null,
  })
}

/** After delivering at a friend's city, the same route flown backwards brings the bird home. */
export function startReturn(durationMin = 25): Trip | null {
  const t = getState().trip
  if (!t) return null
  const back: Trip = { ...t, route: [...t.route].reverse(), progressKm: 0, status: 'RETURNING' }
  setState({ trip: back })
  startSession(back, durationMin)
  return back
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
    const now = Date.now()
    const endMs = reason === 'left' && s.leftAtMs ? s.leftAtMs : now
    const p = computeProgress({ ...s, leftAtMs: s.leftAtMs ?? endMs }, trip, endMs)
    const spot = pointAtKm(trip.route, p.km).pt
    const story = await buildStory(spot[0], spot[1], p.km)
    const id = crypto.randomUUID()
    const cur = getState()
    const stampKnown = cur.stamps.some((x) => x.cc === story.cc)
    const arrived = p.arrived
    let status: Trip['status'] = trip.status
    let letters = cur.letters
    if (arrived && trip.status === 'RETURNING') {
      // home again: the replies the bird carried are ready to open
      letters = letters.map((l) => (l.toId === 'me' && l.status === 'CARRIED' ? { ...l, status: 'DELIVERED' as const } : l))
      status = 'DONE'
    } else if (arrived && trip.friendId) {
      // at the friend's city: hand over my letters and load their reply
      letters = letters.map((l) => (l.fromId === 'me' && l.toId === trip.friendId && l.status === 'CARRIED' ? { ...l, status: 'DELIVERED' as const } : l))
      const friend = cur.friends.find((f) => f.id === trip.friendId)
      if (friend) letters = [replyFrom(friend), ...letters]
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
      landing: result,
      stories: [{ ...story, id, dateMs: now, saved: false }, ...cur.stories],
      sessions: [{ id: crypto.randomUUID(), tripId: trip.id, startMs: s.startMs, endMs, km: p.km - s.baseKm, reason }, ...cur.sessions],
      stamps: stampKnown
        ? cur.stamps.map((x) => (x.cc === story.cc ? { ...x, visits: x.visits + 1 } : x))
        : [...cur.stamps, { cc: story.cc, country: story.country, firstMs: now, visits: 1 }],
    })
    return result
  })().finally(() => {
    landing = null
  })
  return landing
}
