import { beforeEach, describe, expect, it, vi } from 'vitest'

const ln = { schedule: vi.fn(), getPending: vi.fn(), cancel: vi.fn(), checkPermissions: vi.fn(), requestPermissions: vi.fn() }
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: ln }))
import { localNotifier, requestNativeNotificationPermission } from '../src/lib/localNotifier'

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('localNotifier', () => {
  it('schedules each alert at its time with the shared copy', async () => {
    await localNotifier.schedule([{ id: 7, atMs: 5000, place: 'Lisbon' }])
    const arg = ln.schedule.mock.calls[0][0].notifications[0]
    expect(arg.id).toBe(7)
    expect(arg.body).toContain('Lisbon')
    expect(arg.schedule.at).toEqual(new Date(5000))
  })
  it('cancelAll cancels every pending notification', async () => {
    ln.getPending.mockResolvedValue({ notifications: [{ id: 1 }, { id: 2 }] })
    await localNotifier.cancelAll()
    expect(ln.cancel).toHaveBeenCalledWith({ notifications: [{ id: 1 }, { id: 2 }] })
  })
  it('cancelAll does nothing when none are pending', async () => {
    ln.getPending.mockResolvedValue({ notifications: [] })
    await localNotifier.cancelAll()
    expect(ln.cancel).not.toHaveBeenCalled()
  })
})

describe('requestNativeNotificationPermission', () => {
  it('is false and asks nothing on the web', async () => {
    expect(await requestNativeNotificationPermission()).toBe(false)
    expect(ln.requestPermissions).not.toHaveBeenCalled()
  })
  it('requests through the plugin in the app', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true })
    ln.checkPermissions.mockResolvedValue({ display: 'prompt' })
    ln.requestPermissions.mockResolvedValue({ display: 'granted' })
    expect(await requestNativeNotificationPermission()).toBe(true)
  })
  it('does not re-ask when already granted, and is false when the plugin throws', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true })
    ln.checkPermissions.mockResolvedValue({ display: 'granted' })
    expect(await requestNativeNotificationPermission()).toBe(true)
    expect(ln.requestPermissions).not.toHaveBeenCalled()
    ln.checkPermissions.mockRejectedValue(new Error('x'))
    expect(await requestNativeNotificationPermission()).toBe(false)
  })
})
