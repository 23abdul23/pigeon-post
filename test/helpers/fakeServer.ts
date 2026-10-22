// An in-memory stand-in for the Fost API, faithful to the handlers in api/src/handlers for the routes the client's sync and
// flight code use: GET /state, PUT /me, POST /trips, PUT|DELETE /flight, POST /trips/{id}/sessions, POST /import.
// ponytail: no validation, letters, friends or arrivals; add them here if a two-device test needs them.
import type { ActiveFlight, ServerProfile, ServerState, SessionLog, SessionResult, Stamp, Story, Trip } from '../../src/lib/types'

const FLIGHT_STALE_MS = 90_000 // api/src/lib/constants.ts
const KM_PER_FOCUS_MINUTE = 100
const clampKm = (km: number, startMs: number, endMs: number) => Math.max(0, Math.min(km, (Math.max(0, endMs - startMs) / 60000) * KM_PER_FOCUS_MINUTE * 1.05))

type ServerTrip = Omit<Trip, 'route'> & { createdMs: number }
type User = {
  profile: (ServerProfile & { importedAt?: number }) | null
  trips: Map<string, ServerTrip>
  flight: ActiveFlight | null
  sessions: Map<string, SessionLog & { result: SessionResult }>
  stories: Map<string, Story>
  stamps: Map<string, Stamp>
}
export type Reply = { status: number; body?: unknown }

const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
const tripOut = ({ createdMs: _c, ...t }: ServerTrip) => t

export function fakeServer(startMs = Date.UTC(2026, 9, 23, 9)) {
  let clock = startMs
  const users = new Map<string, User>()
  const calls: { sub: string; method: string; path: string; body?: Record<string, unknown> }[] = []
  const user = (sub: string): User => {
    if (!users.has(sub)) users.set(sub, { profile: null, trips: new Map(), flight: null, sessions: new Map(), stories: new Map(), stamps: new Map() })
    return users.get(sub)!
  }

  const state = (sub: string): ServerState => {
    const u = user(sub)
    const { importedAt: _i, ...profile } = u.profile ?? ({} as never)
    const trip = [...u.trips.values()].sort((a, b) => b.createdMs - a.createdMs)[0] // the newest trip is the current one
    return {
      profile: u.profile ? profile : null,
      trip: trip ? tripOut(trip) : null,
      stories: [...u.stories.values()].sort((a, b) => b.dateMs - a.dateMs),
      letters: [],
      friends: [],
      stamps: [...u.stamps.values()].sort((a, b) => a.firstMs - b.firstMs),
      sessions: [...u.sessions.values()].map(({ result: _r, ...s }) => s).sort((a, b) => b.endMs - a.endMs),
      flight: u.flight,
      serverTime: clock,
    }
  }

  const saveProfile = (u: User, fields: Record<string, unknown>) => {
    u.profile = { ...(u.profile ?? { inviteCode: `CODE${users.size}AB` }), ...fields }
    return u.profile
  }

  function putFlight(u: User, b: Record<string, unknown>): Reply {
    const trip = u.trips.get(b.tripId as string)
    if (!trip || (trip.status !== 'OUTBOUND' && trip.status !== 'RETURNING')) return { status: 404, body: { error: 'no flying trip with that id' } }
    const landed = (f: { baseKm: unknown; legs?: unknown }) => Math.abs(Number(f.baseKm) - trip.progressKm) > 0.01 || (f.legs !== undefined && f.legs !== trip.legs)
    const cur = u.flight
    if (cur && cur.deviceId === b.deviceId && cur.startMs === b.startMs) {
      if (landed(cur)) return { status: 409, body: { error: 'flight already landed' } }
      const { leftAtMs: _l, ...rest } = cur
      u.flight = { ...rest, heartbeatMs: clock, ...(b.leftAtMs === undefined ? {} : { leftAtMs: b.leftAtMs as number }) }
      return { status: 200, body: u.flight }
    }
    if (cur && cur.deviceId !== b.deviceId && clock - cur.heartbeatMs <= FLIGHT_STALE_MS && b.takeover !== true) return { status: 409, body: { flight: cur } }
    if (landed(b as never)) return { status: 409, body: { error: 'flight already landed' } }
    const { takeover: _t, ...f } = b
    u.flight = { ...(f as ActiveFlight), heartbeatMs: clock }
    return { status: 200, body: u.flight }
  }

  function landSession(u: User, tripId: string, b: Record<string, unknown>): Reply {
    const seen = u.sessions.get(b.id as string)
    if (seen) {
      if (seen.tripId !== tripId) return { status: 409, body: { error: 'session id belongs to another trip' } }
      if (u.flight?.tripId === tripId && u.flight.startMs === seen.startMs) u.flight = null
      return { status: 200, body: seen.result }
    }
    const trip = u.trips.get(tripId)
    if (!trip) return { status: 404, body: { error: 'trip not found' } }
    const storyIn = b.story as Story
    const progressKm = Math.min(trip.routeKm, trip.progressKm + clampKm(b.kmGained as number, b.startMs as number, b.endMs as number))
    const arrived = progressKm >= trip.routeKm
    const status: Trip['status'] = !arrived ? trip.status : trip.status === 'RETURNING' || !trip.friendId ? 'DONE' : 'DELIVERED'
    const next: ServerTrip = { ...trip, progressKm, legs: trip.legs + 1, status }
    const old = u.stamps.get(storyIn.cc)
    const stamp: Stamp = old ? { ...old, visits: old.visits + 1 } : { cc: storyIn.cc, country: storyIn.country, firstMs: clock, visits: 1 }
    const story: Story = { ...storyIn, km: progressKm, dateMs: clock, saved: false }
    const log: SessionLog = { id: b.id as string, tripId, startMs: b.startMs as number, endMs: b.endMs as number, km: progressKm - trip.progressKm, reason: b.reason as SessionLog['reason'] }
    const result: SessionResult = { trip: tripOut(next), stamp, story, delivered: [], pickedUp: [] }
    u.trips.set(tripId, next)
    u.stamps.set(stamp.cc, stamp)
    u.stories.set(story.id, story)
    u.sessions.set(log.id, { ...log, result })
    if (u.flight?.tripId === tripId) u.flight = null // the landing transaction deletes this trip's flight
    return { status: 200, body: result }
  }

  function importLocal(sub: string, u: User, b: Record<string, unknown>): Reply {
    if (u.profile?.importedAt) return { status: 409, body: { error: 'already imported' } }
    const fields = { ...((b.profile as Record<string, unknown>) ?? {}) }
    for (const k of Object.keys(fields)) if ((u.profile as Record<string, unknown> | null)?.[k] !== undefined) delete fields[k] // the server's fields win
    const origin = u.profile?.homeCity ?? (fields.homeCity as ServerProfile['homeCity'])
    const t = b.trip as ServerTrip | undefined
    if (t && ![...u.trips.keys()].some((id) => id !== t.id) && !u.trips.has(t.id)) u.trips.set(t.id, { ...t, origin, letterIds: [], friendId: undefined, createdMs: clock })
    for (const s of (b.stories as Story[]) ?? []) if (!u.stories.has(s.id)) u.stories.set(s.id, s)
    for (const s of (b.stamps as Stamp[]) ?? []) if (!u.stamps.has(s.cc)) u.stamps.set(s.cc, s)
    for (const s of (b.sessions as SessionLog[]) ?? []) if (!u.sessions.has(s.id)) u.sessions.set(s.id, { ...s, result: undefined as never })
    saveProfile(u, { ...fields, importedAt: clock }) // last, so a half-done import keeps `profile: null`
    return { status: 200, body: state(sub) }
  }

  /** One request from the client's `api(path, init)`. */
  function handle(sub: string, path: string, init: RequestInit = {}): Reply {
    const method = init.method ?? 'GET'
    const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined
    calls.push({ sub, method, path, body })
    const u = user(sub)
    const route = `${method} ${path}`
    if (route === 'GET /state') return { status: 200, body: state(sub) }
    if (route === 'PUT /me' || route === 'POST /me') return { status: 200, body: saveProfile(u, body ?? {}) }
    if (route === 'POST /trips') {
      if (!u.profile?.homeCity) return { status: 400, body: { error: 'set a home city first' } }
      const id = body!.id as string
      if (!u.trips.has(id)) {
        const { route: _r, ...rest } = body as Record<string, unknown>
        u.trips.set(id, { ...(rest as never), letterIds: (body!.letterIds as string[]) ?? [], origin: u.profile.homeCity, progressKm: 0, status: 'OUTBOUND', legs: 0, createdMs: clock })
      }
      return { status: 200, body: tripOut(u.trips.get(id)!) }
    }
    if (route === 'PUT /flight') return putFlight(u, body!)
    if (route === 'DELETE /flight') return (u.flight = null), { status: 204 }
    const landing = /^POST \/trips\/([^/]+)\/sessions$/.exec(route)
    if (landing) return landSession(u, landing[1], body!)
    if (route === 'POST /import') return importLocal(sub, u, body ?? {})
    return { status: 404, body: { error: `fake server: no route ${route}` } }
  }

  return {
    handle: (sub: string, path: string, init?: RequestInit) => copy(handle(sub, path, init)),
    calls,
    /** server time (ms) */
    now: () => clock,
    advance: (ms: number) => void (clock += ms),
    /** what DynamoDB holds for `sub` (a copy) */
    db: (sub: string) => copy({ ...state(sub), importedAt: user(sub).profile?.importedAt, trips: [...user(sub).trips.values()] }),
  }
}
export type FakeServer = ReturnType<typeof fakeServer>
