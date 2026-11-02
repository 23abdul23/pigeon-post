// The Android foreground-service plugin ("Flight"). The native side lives in the Android project; on the web this
// proxy is never called because flightHost only picks it when isNativeApp() is true.

import { registerPlugin } from '@capacitor/core'

export type FlightNative = {
  /** Starts the service, or refreshes its notification when it is already running. Rejects when it cannot start. */
  start(o: { title: string; text: string; endsAtMs: number }): Promise<void>
  stop(): Promise<void>
  /** The screen turned off / on while our app is still the one in front. Each returns an unsubscribe. */
  onScreenOff(cb: () => void): () => void
  onScreenOn(cb: () => void): () => void
  /** The "End flight" action in the notification was tapped. */
  onEndRequested(cb: () => void): () => void
}

export const FlightNativePlugin: FlightNative = registerPlugin<FlightNative>('Flight')
