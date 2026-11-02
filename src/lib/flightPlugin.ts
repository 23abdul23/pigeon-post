// The Android foreground-service plugin ("Flight"). The native side lives in the Android project; on the web this
// proxy is never called because flightHost only picks it when isNativeApp() is true.

import { registerPlugin } from '@capacitor/core'

export type FlightNative = {
  /**
   * Starts the service. Idempotent: when it is already running it only refreshes the notification.
   * `endsAtMs <= 0` means "end unknown": the service neither counts down nor auto-stops.
   * Rejects when the service cannot start.
   */
  start(o: { title: string; text: string; endsAtMs: number }): Promise<void>
  stop(): Promise<void>
  /** The screen turned off / on while our app is still the one in front. Each returns an unsubscribe. */
  onScreenOff(cb: () => void): () => void
  onScreenOn(cb: () => void): () => void
  /** The "End flight" action in the notification was tapped. */
  onEndRequested(cb: () => void): () => void
}

type Handle = { remove(): Promise<void> | void }

/** The plugin as Capacitor exposes it: events are bridge listeners whose handle arrives asynchronously. */
export type RawFlight = {
  start(o: { title: string; text: string; endsAtMs: number }): Promise<void>
  stop(): Promise<void>
  addListener(event: 'screenOff' | 'screenOn' | 'endRequested', cb: () => void): Promise<Handle>
}

/** Adapts bridge listeners to synchronous `(cb) => unsubscribe`; unsubscribing before the handle arrives still removes it. */
export function createFlightNative(raw: RawFlight): FlightNative {
  const on = (event: 'screenOff' | 'screenOn' | 'endRequested') => (cb: () => void) => {
    let off = false
    const handle = raw.addListener(event, cb)
    return () => {
      if (off) return
      off = true
      void handle.then((h) => h.remove(), () => {})
    }
  }
  return {
    start: (o) => raw.start(o),
    stop: () => raw.stop(),
    onScreenOff: on('screenOff'),
    onScreenOn: on('screenOn'),
    onEndRequested: on('endRequested'),
  }
}

export const FlightNativePlugin: FlightNative = createFlightNative(registerPlugin<RawFlight>('Flight'))
