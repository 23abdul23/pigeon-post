// Push notifications for "A letter arrived" in the Android app (Firebase Cloud Messaging through Capacitor). The plugin is
// loaded on demand so the web bundle never pulls it in; every failure is swallowed because push is only a convenience.

import { api } from './api'
import { isNativeApp } from './platform'

/** The slice of the Capacitor PushNotifications plugin this module uses. */
export type PushLike = {
  checkPermissions: () => Promise<{ receive: string }>
  requestPermissions: () => Promise<{ receive: string }>
  register: () => Promise<void>
  addListener: (event: 'registration', cb: (t: { value: string }) => void) => Promise<{ remove: () => Promise<void> }>
}

/** Asks for permission (unless already granted), registers with FCM and hands the device token to `put`. Does nothing when permission is denied. */
export async function registerPush(p: PushLike, put: (token: string) => Promise<void>): Promise<void> {
  let perm = (await p.checkPermissions()).receive
  if (perm !== 'granted') perm = (await p.requestPermissions()).receive
  if (perm !== 'granted') return
  // listen first: the registration event can fire as soon as register() runs
  await p.addListener('registration', (t) => void put(t.value).catch(() => {}))
  await p.register()
}

const TOKEN_KEY = 'pigeon.pushToken'
const stored = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set: (v: string | null) => {
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v)
      else localStorage.removeItem(TOKEN_KEY)
    } catch {
      // storage unavailable: the token is simply not remembered
    }
  },
}

let started = false

export const putDevice = async (token: string) => {
  await api<void>('/devices', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, platform: 'android' }) })
  stored.set(token)
}

/** Android only, after sign-in: creates the `letters` notification channel and registers this device. Never throws. */
export async function startPush(): Promise<void> {
  // every screen's guard calls this: once per app run is enough
  if (!isNativeApp() || started) return
  started = true
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    // FCM messages name this channel; without it Android 8+ would drop them
    await PushNotifications.createChannel({ id: 'letters', name: 'Letters', description: 'A letter arrived', importance: 3 })
    await registerPush(PushNotifications, putDevice)
  } catch {
    // push is optional
  }
}

/** On sign-out: removes this device's token from the server (best effort) so a signed-out phone gets no letter alerts. */
export async function stopPush(): Promise<void> {
  started = false
  const token = stored.get()
  if (!token) return
  try {
    await api<void>(`/devices/${encodeURIComponent(token)}`, { method: 'DELETE' })
    stored.set(null)
  } catch {
    // the server drops the token itself once FCM reports it dead
  }
}
