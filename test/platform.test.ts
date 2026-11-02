import { describe, expect, it } from 'vitest'
import { isNativeApp } from '../src/lib/platform'

describe('isNativeApp', () => {
  it('is false when no Capacitor runtime exists (plain web)', () => {
    expect(isNativeApp({})).toBe(false)
  })

  it('is true when Capacitor reports a native platform', () => {
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => true } })).toBe(true)
  })

  it('is false when Capacitor runs in a browser', () => {
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => false } })).toBe(false)
  })

  it('is false, not a throw, when the Capacitor check itself throws', () => {
    expect(
      isNativeApp({
        Capacitor: {
          isNativePlatform: () => {
            throw new Error('bridge not ready')
          },
        },
      }),
    ).toBe(false)
  })
})
