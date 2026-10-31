// Decides whether the person has LEFT the flight, as opposed to merely having locked their screen.
//
//   present --(page hidden, or desktop window unfocused)--> away --(after DECIDE_MS)--> locked | left
//
// Screen lock keeps flying; switching tab / app / window ends the flight (the caller freezes it with `onLeave`).
// The lock is read from Chrome's Idle Detection (`screen`). Without it (iOS Safari, Firefox, permission refused):
//   mobile  -> a hidden page whose keep-alive audio plays counts as a lock (the earlier behaviour), anything else is leaving;
//   desktop -> hidden or unfocused is leaving (the audio no longer excuses a tab switch).
// While the flight popup (Document Picture-in-Picture) is open the flight stays on screen, so tab switches are not leaving;
// closing it rebuilds the controller, and a page that is still hidden then leaves as above.
// Mobile ignores window focus: the keyboard, the URL bar and dialogs blur the window without the person leaving.

import type { ScreenState } from './idle'

export type PresenceState = 'present' | 'away' | 'locked' | 'left'

export const DECIDE_MS = 2500 // lets a 'locked' report that trails the 'hidden' event arrive, and ignores a blip like the address bar
export const UNLOCK_GRACE_MS = 1500 // unlocking fires before the page is shown again; only still being away after this is leaving

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

export type PresenceDeps = {
  doc: Target & { visibilityState: string; hasFocus(): boolean }
  win: Target
  mobile: boolean
  screen: () => ScreenState
  onScreen: (cb: (s: ScreenState) => void) => () => void
  keepAliveActive: () => boolean
  /** the flight popup is open: it keeps the flight visible, so hiding or blurring this page is not leaving */
  pipActive?: () => boolean
  /** `atMs` is when the person actually left (not when this was decided), on the `now` clock */
  onLeave: (atMs: number) => void
  now?: () => number
}

export function createPresence(deps: PresenceDeps): { stop(): void; state(): PresenceState } {
  const { doc, win, mobile } = deps
  const now = deps.now ?? Date.now
  let st: PresenceState = 'present'
  let awaySince = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const away = () => !deps.pipActive?.() && (doc.visibilityState === 'hidden' || (!mobile && !doc.hasFocus()))
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const leave = (at: number) => {
    clear()
    if (st === 'left') return
    st = 'left'
    deps.onLeave(at)
  }

  const decide = () => {
    timer = undefined
    if (st !== 'away') return
    if (!away()) {
      st = 'present'
      return
    }
    const s = deps.screen()
    if (s === 'locked') st = 'locked'
    else if (s === 'unlocked') leave(awaySince)
    else if (mobile && doc.visibilityState === 'hidden' && deps.keepAliveActive()) st = 'locked' // no lock signal: assume a lock
    else leave(awaySince)
  }

  const evaluate = () => {
    if (st === 'left') return // a new flight makes a new controller
    if (!away()) {
      clear()
      st = 'present'
      return
    }
    if (st !== 'present') return // already deciding or locked
    st = 'away'
    awaySince = now()
    timer = setTimeout(decide, DECIDE_MS)
  }

  const offScreen = deps.onScreen((s) => {
    if (st === 'left') return
    if (s === 'locked' && st === 'away') {
      clear()
      st = 'locked'
    } else if (s === 'unlocked' && st === 'locked' && away()) {
      // unlocked into some other app: that is leaving, unless this page is about to be shown
      clear()
      const unlockedAt = now()
      timer = setTimeout(() => {
        timer = undefined
        if (st === 'locked' && away()) leave(unlockedAt)
      }, UNLOCK_GRACE_MS)
    }
  })

  const onPageHide = () => {
    if (st !== 'locked') leave(now()) // closing or navigating away; a locked phone is not leaving
  }

  doc.addEventListener('visibilitychange', evaluate)
  win.addEventListener('blur', evaluate)
  win.addEventListener('focus', evaluate)
  win.addEventListener('pagehide', onPageHide)
  evaluate()

  return {
    state: () => st,
    stop() {
      clear()
      offScreen()
      doc.removeEventListener('visibilitychange', evaluate)
      win.removeEventListener('blur', evaluate)
      win.removeEventListener('focus', evaluate)
      win.removeEventListener('pagehide', onPageHide)
    },
  }
}

/** Phones and tablets: where a screen lock is a normal part of a focus session. */
export function isMobileDevice(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & { userAgentData?: { mobile?: boolean } } = navigator): boolean {
  if (nav.userAgentData?.mobile) return true
  const ua = nav.userAgent ?? ''
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1) // iPadOS reports a Mac
}
