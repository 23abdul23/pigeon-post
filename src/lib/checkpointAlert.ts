import { getState } from './store'

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
