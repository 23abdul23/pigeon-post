import { useSyncExternalStore } from 'react'
import type { City, Bird, Place, Trip, Story, Letter, Friend, Stamp, SessionLog, Settings, Profile, ServerProfile, ServerState, SessionResult, ActiveFlight } from './types'

export type { City, Bird, Place, Trip, Story, Letter, Friend, Stamp, SessionLog, Settings, Profile, ServerProfile, ServerState, SessionResult, ActiveFlight }

export type ActiveSession = {
  tripId: string
  startMs: number
  durationMin: number
  baseKm: number
  /** the trip's legs when the flight started (sent with every `PUT /flight`) */
  legs?: number
  leftAtMs?: number
  /** last time the focus screen was alive; a stale value on load means the page was closed or reloaded */
  heartbeatMs?: number
}

export type Landing = {
  storyId: string
  tripId: string
  reason: 'completed' | 'left' | 'ended'
  /** distance reached on the trip when the bird landed */
  km: number
  /** distance gained in the session that just ended */
  gainedKm: number
  focusedMs: number
  durationMin: number
  /** when the session ended (the moment the tab was left, for reason 'left') */
  atMs: number
  newStampCc?: string
}

export const defaultSettings: Settings = {
  bio: '',
  volume: 40,
  coo: true,
  rustle: true,
  ambience: true,
  notifyLetter: true,
  notifyBird: true,
  notifyFriend: true,
  channel: 'email',
  shareBird: true,
  shareStats: true,
}

export type State = {
  user: { name: string; email: string } | null
  homeCity: City | null
  bird: Bird | null
  soundOn: boolean
  trip: Trip | null
  /** this device's own flight (all times are server time, see `serverNow`) */
  session: ActiveSession | null
  /** the server's view of the flight in progress, from `GET /state` or `PUT /flight` (may be another device's) */
  flight: ActiveFlight | null
  /** serverTime - Date.now() at the last `GET /state` */
  clockOffsetMs: number
  landing: Landing | null
  stories: Story[]
  letters: Letter[]
  friends: Friend[]
  stamps: Stamp[]
  sessions: SessionLog[]
  settings: Settings
  /** the caller's own invite code, from the server */
  inviteCode: string | null
}

const KEY = 'pigeon-post:v1'

const initial: State = {
  user: null,
  homeCity: null,
  bird: null,
  soundOn: true,
  trip: null,
  session: null,
  flight: null,
  clockOffsetMs: 0,
  landing: null,
  stories: [],
  letters: [],
  friends: [],
  stamps: [],
  sessions: [],
  settings: defaultSettings,
  inviteCode: null,
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initial
    const saved = JSON.parse(raw)
    return { ...initial, ...saved, settings: { ...defaultSettings, ...saved.settings } }
  } catch {
    return initial
  }
}

let state: State = load()
const listeners = new Set<() => void>()

export function getState() {
  return state
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // storage unavailable: keep in-memory state only
  }
  listeners.forEach((l) => l())
}

/** Applies `GET /state` (its trip with the route recomputed), except the entity groups in `held` (local writes pending). */
export function hydrate(s: Omit<ServerState, 'trip'> & { trip: Trip | null }, held: ReadonlySet<string> = new Set()): void {
  const p = s.profile
  const take = <T>(group: string, v: T): T | undefined => (held.has(group) ? undefined : v)
  const patch: Partial<State> = {
    trip: take('trip', s.trip),
    stories: take('stories', s.stories),
    stamps: take('stamps', s.stamps),
    sessions: take('sessions', s.sessions),
    friends: take('friends', s.friends),
    letters: take('letters', s.letters),
  }
  setState((st) => ({
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    ...(held.has('profile')
      ? {}
      : {
          inviteCode: p?.inviteCode ?? null,
          homeCity: p?.homeCity ?? null,
          bird: p?.bird ?? null,
          settings: { ...defaultSettings, ...p?.settings },
          user: st.user && p?.name ? { ...st.user, name: p.name } : st.user,
        }),
  }))
}

export function resetState() {
  state = initial
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => select(state),
  )
}
