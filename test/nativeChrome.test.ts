import { describe, expect, it } from 'vitest'
import { applyNativeClasses, decideBack } from '../src/lib/nativeChrome'

const base = { path: '/mailbox', flightActive: false, dialogOpen: false, canGoBack: true }

describe('decideBack', () => {
  it('dialog_open_closes_dialog_first', () => {
    expect(decideBack({ ...base, dialogOpen: true, flightActive: true, path: '/fly/t1' })).toBe('close-dialog')
  })
  it('active_flight_asks_to_confirm', () => {
    expect(decideBack({ ...base, flightActive: true, path: '/fly/t1' })).toBe('confirm-end-flight')
    expect(decideBack({ ...base, flightActive: true, path: '/fly/t1', canGoBack: false })).toBe('confirm-end-flight')
  })
  it('history_available_navigates_back', () => {
    expect(decideBack(base)).toBe('navigate-back')
    expect(decideBack({ ...base, path: '/home' })).toBe('navigate-back')
  })
  it('home_without_history_exits', () => {
    expect(decideBack({ ...base, path: '/home', canGoBack: false })).toBe('exit-app')
  })
  it('non_home_without_history_navigates_to_home_not_exit', () => {
    expect(decideBack({ ...base, canGoBack: false })).toBe('navigate-back')
  })
})

describe('applyNativeClasses', () => {
  it('applyNativeClasses_adds_native_app', () => {
    const added: string[] = []
    applyNativeClasses({ classList: { add: (c) => void added.push(c) } })
    expect(added).toEqual(['native-app'])
  })
})
