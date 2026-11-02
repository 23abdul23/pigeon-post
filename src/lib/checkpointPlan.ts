import { KM_PER_FOCUS_MINUTE } from './geo'

export const CHECKPOINT_NOTIFICATION_TITLE = 'Checkpoint reached'
export const CHECKPOINT_NOTIFICATION_BODY = (place: string) => `Your bird reached ${place}`
export const CHECKPOINT_FALLBACK_PLACE = 'the next stop'

export type PlannedAlert = { id: number; atMs: number; place: string }
export type LocalNotifierLike = { schedule(a: PlannedAlert[]): Promise<void>; cancelAll(): Promise<void> }

export const checkpointBody = CHECKPOINT_NOTIFICATION_BODY

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) % 2147483647 || 1 // positive 31-bit: Android notification ids are ints
}

/** The checkpoint notifications still to come for a flight: stop `i` is reached when the clock has flown from `startKm` to `stopKms[i]`. */
export function planCheckpointAlerts(o: { startMs: number; startKm: number; stopKms: number[]; places: string[]; nowMs: number; kmPerMin?: number }): PlannedAlert[] {
  const kmPerMin = o.kmPerMin ?? KM_PER_FOCUS_MINUTE
  const used = new Set<number>()
  const out: PlannedAlert[] = []
  o.stopKms.forEach((km, i) => {
    const atMs = o.startMs + ((km - o.startKm) / kmPerMin) * 60000
    if (km <= o.startKm || atMs <= o.nowMs) return
    let id = hash(`${o.startMs}:${Math.round(km)}`)
    while (used.has(id)) id = (id % 2147483647) + 1
    used.add(id)
    out.push({ id, atMs, place: o.places[i] || CHECKPOINT_FALLBACK_PLACE })
  })
  return out.sort((a, b) => a.atMs - b.atMs)
}
