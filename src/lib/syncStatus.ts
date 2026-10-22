import { useSyncExternalStore } from 'react'

export type SyncStatus = { state: 'synced' | 'syncing' | 'offline' | 'error'; pending: number; lastError?: string; lastSyncMs?: number }

let status: SyncStatus = { state: 'synced', pending: 0 }
const listeners = new Set<() => void>()

export const getSyncStatus = () => status

export function setSyncStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  listeners.forEach((l) => l())
}

/** Marks a successful sync: clears any error and stamps the time. */
export const markSynced = () => setSyncStatus({ state: 'synced', pending: 0, lastError: undefined, lastSyncMs: Date.now() })

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    getSyncStatus,
    getSyncStatus,
  )
}
