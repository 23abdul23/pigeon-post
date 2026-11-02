// Keep-alive facade for Focus. On the web it is the quiet-audio hack in keepAlive.ts, unchanged; in the Android app it
// drives the Flight foreground service instead, with the same call shape and the same grace-period rule on release.

import * as keepAliveApi from './keepAlive'
import type { KeepAliveMeta } from './keepAlive'
import { FlightNativePlugin, type FlightNative } from './flightPlugin'
import { isNativeApp } from './platform'

export type FlightHostApi = {
  ensureKeepAlive(meta: KeepAliveMeta): Promise<boolean>
  releaseKeepAlive(graceMs?: number): void
  isKeepAliveActive(): boolean
  setKeepAliveMeta(meta: KeepAliveMeta): void
  setKeepAlivePosition(durationSec: number, positionSec: number): void
}

export function createFlightHost(native: FlightNative | null, web: FlightHostApi = keepAliveApi): FlightHostApi {
  if (!native) return web

  let active = false
  let starting: Promise<boolean> | null = null
  let releaseTimer: ReturnType<typeof setTimeout> | undefined
  let meta: KeepAliveMeta = { title: '' }
  let endsAtMs = Date.now()

  const options = () => ({ title: meta.title, text: meta.artist ?? '', endsAtMs })
  const refresh = () => {
    if (active) native.start(options()).catch(() => {}) // cosmetic: the service keeps running
  }

  return {
    ensureKeepAlive(m) {
      clearTimeout(releaseTimer)
      meta = m
      if (active) return Promise.resolve(true)
      starting ??= native
        .start(options())
        .then(() => (active = true))
        .catch(() => (active = false))
        .finally(() => (starting = null))
      return starting
    },
    releaseKeepAlive(graceMs = 2000) {
      clearTimeout(releaseTimer)
      releaseTimer = setTimeout(() => {
        active = false
        native.stop().catch(() => {})
      }, graceMs)
    },
    isKeepAliveActive: () => active,
    setKeepAliveMeta(m) {
      meta = m
      refresh()
    },
    setKeepAlivePosition(durationSec, positionSec) {
      if (!(durationSec > 0)) return
      endsAtMs = Date.now() + (durationSec - Math.min(durationSec, Math.max(0, positionSec))) * 1000
      refresh()
    },
  }
}

const host = createFlightHost(isNativeApp() ? FlightNativePlugin : null)

export const { ensureKeepAlive, releaseKeepAlive, isKeepAliveActive, setKeepAliveMeta, setKeepAlivePosition } = host
