import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/auth', () => ({ COGNITO_CONFIGURED: false, currentSub: vi.fn(), getUserSub: vi.fn() }))
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

import { api } from '../src/lib/api'
import { loadServerState, refreshAll } from '../src/lib/sync'
import { getSyncStatus } from '../src/lib/syncStatus'

describe('sync without Cognito (offline dev)', () => {
  it('loadServerState_and_refreshAll_are_noops_and_status_stays_synced', async () => {
    await loadServerState()
    await refreshAll()
    expect(api).not.toHaveBeenCalled()
    expect(getSyncStatus().state).toBe('synced')
  })
})
