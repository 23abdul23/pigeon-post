// Chrome's Idle Detection API is the only web API that reports whether the SCREEN IS LOCKED, which is what tells a locked phone
// (keep flying) from a switch to another app (the bird stops). It needs a one-time permission and exists in Chrome and Edge only.

export type ScreenState = 'locked' | 'unlocked' | 'unknown'
export type IdlePermission = 'granted' | 'denied' | 'prompt' | 'unsupported'

type IdleDetectorLike = EventTarget & {
  screenState: 'locked' | 'unlocked' | null
  start(options: { threshold: number; signal?: AbortSignal }): Promise<void>
}
type IdleDetectorCtor = { new (): IdleDetectorLike; requestPermission(): Promise<'granted' | 'denied'> }

const ctor = (): IdleDetectorCtor | undefined => (globalThis as { IdleDetector?: IdleDetectorCtor }).IdleDetector

export const idleSupported = (): boolean => !!ctor()

export async function idlePermission(): Promise<IdlePermission> {
  if (!idleSupported()) return 'unsupported'
  try {
    const status = await navigator.permissions.query({ name: 'idle-detection' as PermissionName })
    return status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'prompt'
  } catch {
    return 'prompt' // the Permissions API may not know this name; asking is still possible
  }
}

/** Shows Chrome's prompt. Must run inside a click handler (it needs a user gesture). */
export async function requestIdlePermission(): Promise<boolean> {
  try {
    return (await ctor()?.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

const ASKED_KEY = 'fost:idle-asked'
const REASK_AFTER_MS = 7 * 24 * 3600 * 1000

/** Ask only when Chrome would show its prompt and the person has not already said "not now" this week. */
export async function shouldAskIdlePermission(now = Date.now()): Promise<boolean> {
  if ((await idlePermission()) !== 'prompt') return false
  try {
    const asked = Number(localStorage.getItem(ASKED_KEY) ?? 0)
    return !asked || now - asked > REASK_AFTER_MS
  } catch {
    return true
  }
}

export function markIdleAsked(now = Date.now()): void {
  try {
    localStorage.setItem(ASKED_KEY, String(now))
  } catch {
    // storage unavailable: the explainer may show again, which is harmless
  }
}

export type ScreenWatch = {
  /** 'unknown' until the detector runs (no support, no permission, or still starting) */
  screen(): ScreenState
  subscribe(cb: (s: ScreenState) => void): () => void
  stop(): void
}

/** Returns at once; the detector starts in the background when the permission is already granted. */
export function startScreenWatch(): ScreenWatch {
  let state: ScreenState = 'unknown'
  const listeners = new Set<(s: ScreenState) => void>()
  const abort = new AbortController()
  const set = (s: ScreenState) => {
    if (s === state) return
    state = s
    listeners.forEach((l) => l(s))
  }
  void (async () => {
    try {
      if ((await idlePermission()) !== 'granted') return
      const detector = new (ctor() as IdleDetectorCtor)()
      detector.addEventListener('change', () => set(detector.screenState ?? 'unknown'))
      await detector.start({ threshold: 60_000, signal: abort.signal })
      if (!abort.signal.aborted) set(detector.screenState ?? 'unknown')
    } catch {
      // permission revoked or the API failed: stay 'unknown' and let the caller's fallback rule apply
    }
  })()
  return {
    screen: () => state,
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    stop() {
      abort.abort()
      listeners.clear()
    },
  }
}
