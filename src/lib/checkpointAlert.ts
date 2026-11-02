import { getState } from './store'
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

/** Schedules `plan` and returns the function that cancels it. A stop before the schedule finished cancels right after it, so nothing stays scheduled. */
export function keepCheckpointsScheduled(n: LocalNotifierLike, plan: PlannedAlert[]): () => void {
  const scheduled = scheduleCheckpoints(n, plan)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    void scheduled.then(() => cancelCheckpoints(n))
  }
}
