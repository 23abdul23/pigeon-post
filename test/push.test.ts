import { describe, expect, it, vi } from 'vitest'
import { pushEnabled, registerPush, startPush, type PushLike } from '../src/lib/push'

const fake = (perm: 'granted' | 'denied' | 'prompt', afterRequest: 'granted' | 'denied' = 'granted') => {
  const calls: string[] = []
  let cb: ((t: { value: string }) => void) | undefined
  const p: PushLike = {
    checkPermissions: vi.fn(async () => (calls.push('check'), { receive: perm })),
    requestPermissions: vi.fn(async () => (calls.push('request'), { receive: afterRequest })),
    register: vi.fn(async () => {
      calls.push('register')
      cb?.({ value: 'fcm-token' })
    }),
    addListener: vi.fn(async (_e: 'registration', f: (t: { value: string }) => void) => {
      calls.push('listen')
      cb = f
      return { remove: async () => {} }
    }),
  }
  return { p, calls }
}

describe('registerPush', () => {
  it('registerPush_requests_permission_then_puts_the_token', async () => {
    const { p, calls } = fake('prompt')
    const put = vi.fn(async () => {})
    await registerPush(p, put)
    expect(calls).toEqual(['check', 'request', 'listen', 'register'])
    expect(put).toHaveBeenCalledExactlyOnceWith('fcm-token')
  })

  it('registerPush_skips_the_prompt_when_already_granted', async () => {
    const { p, calls } = fake('granted')
    const put = vi.fn(async () => {})
    await registerPush(p, put)
    expect(calls).toEqual(['check', 'listen', 'register'])
    expect(put).toHaveBeenCalledWith('fcm-token')
  })

  it('registerPush_does_nothing_when_permission_denied', async () => {
    const { p } = fake('prompt', 'denied')
    const put = vi.fn(async () => {})
    await registerPush(p, put)
    expect(p.register).not.toHaveBeenCalled()
    expect(p.addListener).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })
})

const plugin = { createChannel: vi.fn(), checkPermissions: vi.fn(), requestPermissions: vi.fn(), register: vi.fn(), addListener: vi.fn() }
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }))

describe('push build flag', () => {
  it('pushEnabled_is_false_by_default_and_true_only_for_the_string_true', () => {
    expect(pushEnabled({})).toBe(false)
    for (const v of [undefined, '', 'false', 'TRUE', '1', 'yes', true]) expect(pushEnabled({ VITE_PUSH_ENABLED: v })).toBe(false)
    expect(pushEnabled({ VITE_PUSH_ENABLED: 'true' })).toBe(true)
  })

  it('startPush_never_touches_the_plugin_when_push_is_disabled', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true })
    try {
      await startPush(false)
      await startPush() // the test environment sets no flag
      for (const f of Object.values(plugin)) expect(f).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
