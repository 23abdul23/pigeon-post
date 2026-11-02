// The Android app's local-notifications plugin behind the small LocalNotifierLike shape. Loaded on demand so the web bundle never pulls it in.

import { CHECKPOINT_NOTIFICATION_BODY, CHECKPOINT_NOTIFICATION_TITLE, type LocalNotifierLike } from './checkpointPlan'
import { isNativeApp } from './platform'

const plugin = async () => (await import('@capacitor/local-notifications')).LocalNotifications

export const localNotifier: LocalNotifierLike = {
  async schedule(alerts) {
    const ln = await plugin()
    await ln.schedule({
      notifications: alerts.map((a) => ({
        id: a.id,
        title: CHECKPOINT_NOTIFICATION_TITLE,
        body: CHECKPOINT_NOTIFICATION_BODY(a.place),
        schedule: { at: new Date(a.atMs), allowWhileIdle: true },
      })),
    })
  },
  async cancelAll() {
    const ln = await plugin()
    const { notifications } = await ln.getPending()
    if (notifications.length) await ln.cancel({ notifications: notifications.map((n) => ({ id: n.id })) })
  },
}

/** Asks for the Android 13+ notification permission (POST_NOTIFICATIONS) through the plugin. True when granted; false on the web or on any failure. */
export async function requestNativeNotificationPermission(): Promise<boolean> {
  if (!isNativeApp()) return false
  try {
    const ln = await plugin()
    const cur = await ln.checkPermissions()
    if (cur.display === 'granted') return true
    return (await ln.requestPermissions()).display === 'granted'
  } catch {
    return false
  }
}
