// Keeps the screen from locking BY ITSELF while a flight is on screen. The browser releases the lock whenever the page is
// hidden, so it is asked for again each time the page becomes visible. A manual lock (power button) is not prevented.

type Sentinel = { release(): Promise<void>; addEventListener?(type: 'release', cb: () => void): void }
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> }

export const wakeLockSupported = (nav: Navigator = navigator): boolean => 'wakeLock' in nav

/** Starts holding the lock; call the returned function to let go. Never throws (unsupported, denied, low power mode). */
export function holdWakeLock(nav: Navigator = navigator, doc: Document = document): () => void {
  let sentinel: Sentinel | null = null
  let stopped = false
  let requesting = false // two quick 'visible' events must not take two locks before the first request resolves
  const acquire = async () => {
    if (stopped || sentinel || requesting || doc.visibilityState !== 'visible' || !wakeLockSupported(nav)) return
    requesting = true
    try {
      const s = await (nav as Navigator & { wakeLock: WakeLockApi }).wakeLock.request('screen')
      if (stopped) {
        void s.release().catch(() => {})
        return
      }
      sentinel = s
      s.addEventListener?.('release', () => {
        if (sentinel === s) sentinel = null // released by the browser (page hidden, low battery): ask again on return
      })
    } catch {
      // not allowed right now; the next visibilitychange tries again
    } finally {
      requesting = false
    }
  }
  const onVisible = () => void acquire()
  doc.addEventListener('visibilitychange', onVisible)
  void acquire()
  return () => {
    stopped = true
    doc.removeEventListener('visibilitychange', onVisible)
    const s = sentinel
    sentinel = null
    if (s) void s.release().catch(() => {})
  }
}
