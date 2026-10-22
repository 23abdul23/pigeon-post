import { useSyncExternalStore } from 'react'
import type { City, Bird, Place, Trip, Story, Letter, Friend, Stamp, SessionLog, Settings, Profile, ServerProfile, ServerState } from './types'

export type { City, Bird, Place, Trip, Story, Letter, Friend, Stamp, SessionLog, Settings, Profile, ServerProfile, ServerState }

export type ActiveSession = {
  tripId: string
  startMs: number
  durationMin: number
  baseKm: number
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
  session: ActiveSession | null
  landing: Landing | null
  stories: Story[]
  letters: Letter[]
  friends: Friend[]
  stamps: Stamp[]
  sessions: SessionLog[]
  settings: Settings
}

const KEY = 'pigeon-post:v1'

const initial: State = {
  user: null,
  homeCity: null,
  bird: null,
  soundOn: true,
  trip: null,
  session: null,
  landing: null,
  stories: [],
  letters: [],
  friends: [],
  stamps: [],
  sessions: [],
  settings: defaultSettings,
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
