// The single switch between the web build and the Capacitor Android app. The native runtime injects `window.Capacitor`
// before the page loads, so reading it needs no import and the web bundle stays free of Capacitor code.

type CapacitorLike = { isNativePlatform?: () => boolean }

/** True only inside the installed Android app. Never throws: any doubt means "web". */
export function isNativeApp(g: { Capacitor?: CapacitorLike } = globalThis as { Capacitor?: CapacitorLike }): boolean {
  try {
    return g.Capacitor?.isNativePlatform?.() === true
  } catch {
    return false
  }
}
