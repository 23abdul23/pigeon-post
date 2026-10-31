import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alertCheckpoint } from '../src/lib/checkpointAlert'
import { defaultSettings, getState, setState } from '../src/lib/store'

class FakeNotification {
  static permission = 'granted'
  static made: FakeNotification[] = []
  onclick: (() => void) | null = null
  constructor(public title: string, public opts: { body: string; tag: string }) {
    FakeNotification.made.push(this)
  }
  close = vi.fn()
}

beforeEach(() => {
  FakeNotification.permission = 'granted'
  FakeNotification.made = []
  vi.stubGlobal('Notification', FakeNotification)
  setState({ settings: { ...defaultSettings, notifyBird: true } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  setState({ settings: defaultSettings })
})

describe('alertCheckpoint', () => {
  it('shows a notification when permission is granted and notifyBird is on', () => {
    expect(alertCheckpoint('Lisbon', () => {})).toBe(true)
    const n = FakeNotification.made[0]
    expect(n.title).toBe('Checkpoint reached')
    expect(n.opts.body).toBe('Your bird reached Lisbon')
    expect(n.opts.tag).toBe('checkpoint')
  })

  it('clicking the notification calls onClick', () => {
    const onClick = vi.fn()
    alertCheckpoint('Lisbon', onClick)
    FakeNotification.made[0].onclick?.()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('returns false and shows nothing when permission is denied', () => {
    FakeNotification.permission = 'denied'
    expect(alertCheckpoint('Lisbon', () => {})).toBe(false)
    expect(FakeNotification.made).toEqual([])
  })

  it('returns false when Notification is undefined', () => {
    vi.stubGlobal('Notification', undefined)
    expect(alertCheckpoint('Lisbon', () => {})).toBe(false)
  })

  it('returns false when settings.notifyBird is false', () => {
    setState({ settings: { ...getState().settings, notifyBird: false } })
    expect(alertCheckpoint('Lisbon', () => {})).toBe(false)
    expect(FakeNotification.made).toEqual([])
  })

  it('returns false when constructing the notification throws', () => {
    vi.stubGlobal('Notification', class { static permission = 'granted'; constructor() { throw new TypeError('Illegal constructor') } })
    expect(alertCheckpoint('Lisbon', () => {})).toBe(false)
  })
})
