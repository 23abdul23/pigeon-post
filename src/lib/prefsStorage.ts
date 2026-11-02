/**
 * oidc-client-ts AsyncStorage over Capacitor Preferences, so Android tokens survive WebView
 * localStorage eviction.
 *
 * SECURITY NOTE: Preferences is app-private storage (SharedPreferences), NOT Keystore-encrypted.
 * Hardening with an encrypted store is a follow-up.
 */
import type { AsyncStorage } from 'oidc-client-ts'

export type PrefsLike = {
  get(o: { key: string }): Promise<{ value: string | null }>
  set(o: { key: string; value: string }): Promise<void>
  remove(o: { key: string }): Promise<void>
  keys(): Promise<{ keys: string[] }>
  clear(): Promise<void>
}

export function createPrefsStorage(prefs: PrefsLike, prefix = 'oidc.'): AsyncStorage {
  const ownKeys = async () => (await prefs.keys()).keys.filter((k) => k.startsWith(prefix))
  return {
    get length() {
      return ownKeys().then((k) => k.length)
    },
    async clear() {
      await Promise.all((await ownKeys()).map((key) => prefs.remove({ key })))
    },
    // A read failure means "signed out", not a crash.
    getItem: (key) => prefs.get({ key: prefix + key }).then((r) => r.value, () => null),
    async key(index) {
      const k = (await ownKeys())[index]
      return k === undefined ? null : k.slice(prefix.length)
    },
    removeItem: (key) => prefs.remove({ key: prefix + key }),
    // Rejections propagate so a failed token write is visible.
    setItem: (key, value) => prefs.set({ key: prefix + key, value }),
  }
}
