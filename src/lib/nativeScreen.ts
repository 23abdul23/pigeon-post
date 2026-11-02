// Adapts the native Android plugin's screen-off / screen-on events into the `screen` / `onScreen` shape
// that createPresence expects. Screen off reads as 'locked' (the flight keeps going while our app is in front);
// screen on reads as 'unlocked'. Switching to another app is not a screen event: presence sees it as the page hiding.

import type { ScreenState } from './idle'

export type ScreenEvents = {
  onScreenOff(cb: () => void): () => void
  onScreenOn(cb: () => void): () => void
}

export function nativeScreenSource(ev: ScreenEvents): {
  screen: () => ScreenState
  onScreen: (cb: (s: ScreenState) => void) => () => void
  stop(): void
} {
  let state: ScreenState = 'unlocked'
  const subs = new Set<(s: ScreenState) => void>()
  const set = (s: ScreenState) => {
    state = s
    for (const cb of [...subs]) cb(s)
  }
  const offOff = ev.onScreenOff(() => set('locked'))
  const offOn = ev.onScreenOn(() => set('unlocked'))
  return {
    screen: () => state,
    onScreen(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    stop() {
      offOff()
      offOn()
      subs.clear()
    },
  }
}
