import { getState, type ActiveSession } from './store'
import type { LocalNotifierLike, PlannedAlert } from './checkpointPlan'

/** Tells the person their bird reached a checkpoint. Clicking it is the reliable way to bring the main tab forward, because a background page cannot focus itself. Returns true when shown. */
export function alertCheckpoint(place: string, onClick: () => void): boolean {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
    if (!getState().settings.notifyBird) return false
    const n = new Notification('Checkpoint reached', { body: `Your bird reached ${place}`, tag: 'checkpoint' })
    n.onclick = () => {
      onClick()
      n.close()
    }
    return true
  } catch {
    return false
  }
}

/** Hands the planned checkpoint notifications to the OS so they fire with the page frozen or the screen off. Never throws: a failure must not break the flight. */
export async function scheduleCheckpoints(n: LocalNotifierLike, plan: PlannedAlert[]): Promise<void> {
  if (!plan.length) return
  try {
    await n.schedule(plan)
  } catch (e) {
    console.warn('scheduling checkpoint notifications failed', e)
  }
}

/** Removes every scheduled checkpoint notification (flight ended, landed or left). Never throws. */
export async function cancelCheckpoints(n: LocalNotifierLike): Promise<void> {
  try {
    await n.cancelAll()
  } catch (e) {
    console.warn('cancelling checkpoint notifications failed', e)
  }
}

/** A heartbeat older than this when the app loads means the flight screen died (closed, reloaded, process killed). Focus treats it as leaving. */
export const STALE_HEARTBEAT_MS = 3000

/**
 * App start: OS-scheduled checkpoint alarms outlive a swipe-away or a killed process, so cancel them unless a flight is
 * really running (session present, not left, heartbeat fresh — the same test Focus applies on load). Returns true when it
 * cancelled. Never throws.
 */
export async function cancelOrphanedCheckpoints(d: { session: ActiveSession | null; now: number; notifier: LocalNotifierLike }): Promise<boolean> {
  const s = d.session
  const flying = !!s && !s.leftAtMs && d.now - (s.heartbeatMs ?? s.startMs) <= STALE_HEARTBEAT_MS
  if (flying) return false
  await cancelCheckpoints(d.notifier)
  return true
}

const chains = new WeakMap<LocalNotifierLike, Promise<void>>()

/** Runs `op` after every earlier operation on `n` has finished (even a failed one), so schedule and cancel never interleave. */
function enqueue(n: LocalNotifierLike, op: () => Promise<void>): Promise<void> {
  const next = (chains.get(n) ?? Promise.resolve()).catch(() => undefined).then(op)
  chains.set(n, next.catch(() => undefined))
  return next
}

/** Schedules `plan` and returns the function that cancels it. All operations on `n` run strictly in order: a stop cancels after its own schedule, and a re-run's new schedule starts only after that cancel. */
export function keepCheckpointsScheduled(n: LocalNotifierLike, plan: PlannedAlert[]): () => void {
  void enqueue(n, () => scheduleCheckpoints(n, plan))
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    void enqueue(n, () => cancelCheckpoints(n))
  }
}
