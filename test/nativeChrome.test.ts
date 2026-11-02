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

import { afterEach, vi } from 'vitest'
import {
  closeTopDialog,
  dialogOpen,
  handleBack,
  registerDialog,
  registerEndFlightPrompt,
  startNativeChrome,
  backEnvFromRef,
  type BackEnv,
} from '../src/lib/nativeChrome'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})
const env = (over: Partial<BackEnv> = {}): BackEnv & { navigate: ReturnType<typeof vi.fn>; exitApp: ReturnType<typeof vi.fn> } =>
  ({ path: () => '/mailbox', canGoBack: () => true, navigate: vi.fn(), exitApp: vi.fn(), ...over }) as never

describe('handleBack', () => {
  it('handleBack_closes_the_top_dialog_before_anything_else', () => {
    const calls: string[] = []
    cleanups.push(registerDialog(() => calls.push('lower')), registerDialog(() => calls.push('top')))
    cleanups.push(registerEndFlightPrompt(() => calls.push('prompt')))
    const e = env({ path: () => '/fly/t1' })
    expect(handleBack(e)).toBe('close-dialog')
    expect(calls).toEqual(['top'])
    expect(e.navigate).not.toHaveBeenCalled()
    expect(e.exitApp).not.toHaveBeenCalled()
  })
  it('handleBack_asks_to_confirm_end_flight_when_a_flight_prompt_is_registered', () => {
    const show = vi.fn()
    cleanups.push(registerEndFlightPrompt(show))
    const e = env({ path: () => '/fly/t1', canGoBack: () => false })
    expect(handleBack(e)).toBe('confirm-end-flight')
    expect(show).toHaveBeenCalledOnce()
    expect(e.exitApp).not.toHaveBeenCalled()
    expect(e.navigate).not.toHaveBeenCalled()
  })
  it('handleBack_navigates_back_on_a_stale_fly_path_without_a_registered_prompt', () => {
    const e = env({ path: () => '/fly/t1', canGoBack: () => false })
    expect(handleBack(e)).toBe('navigate-back')
    expect(e.navigate).toHaveBeenCalledWith('/home')
    expect(e.exitApp).not.toHaveBeenCalled()
    const e2 = env({ path: () => '/fly/t1' })
    expect(handleBack(e2)).toBe('navigate-back')
    expect(e2.navigate).toHaveBeenCalledWith(-1)
  })
  it('handleBack_exits_only_at_home_with_no_history_and_no_flight', () => {
    const e = env({ path: () => '/home', canGoBack: () => false })
    expect(handleBack(e)).toBe('exit-app')
    expect(e.exitApp).toHaveBeenCalledOnce()
    const e2 = env({ path: () => '/home', canGoBack: () => true })
    expect(handleBack(e2)).toBe('navigate-back')
    expect(e2.exitApp).not.toHaveBeenCalled()
  })
})

describe('registries', () => {
  it('dialog_registry_unregister_is_by_identity_so_out_of_order_unmounts_are_safe', () => {
    const calls: string[] = []
    const offA = registerDialog(() => calls.push('a'))
    const offB = registerDialog(() => calls.push('b'))
    offA() // a unmounts first
    offA() // double unregister is harmless
    expect(dialogOpen()).toBe(true)
    expect(closeTopDialog()).toBe(true)
    expect(calls).toEqual(['b'])
    offB()
    expect(dialogOpen()).toBe(false)
    expect(closeTopDialog()).toBe(false)
  })
  it('end_flight_prompt_unregisters_only_if_still_current', () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = registerEndFlightPrompt(first)
    const offSecond = registerEndFlightPrompt(second)
    offFirst() // stale cleanup must not clear the newer prompt
    expect(handleBack(env({ path: () => '/fly/t' }))).toBe('confirm-end-flight')
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
    offSecond()
    expect(handleBack(env({ path: () => '/fly/t' }))).toBe('navigate-back')
  })
})

describe('startNativeChrome', () => {
  const fakeDeps = () => {
    const remove = vi.fn()
    const listeners: Array<() => void> = []
    const deps = {
      root: { classList: { add: vi.fn() } },
      setupStatusBar: vi.fn(async () => {}),
      app: {
        addListener: vi.fn(async (_e: 'backButton', cb: () => void) => {
          listeners.push(cb)
          return { remove }
        }),
        exitApp: vi.fn(),
      },
    }
    return { deps, remove, listeners }
  }
  it('native_chrome_registers_back_listener_once_and_stop_removes_it', async () => {
    const { deps, remove, listeners } = fakeDeps()
    const stop = await startNativeChrome(env(), deps)
    expect(deps.app.addListener).toHaveBeenCalledOnce()
    expect(deps.root.classList.add).toHaveBeenCalledWith('native-app')
    expect(remove).not.toHaveBeenCalled()
    // a second start (e.g. a remount) replaces the first rather than leaving two listeners
    const stop2 = await startNativeChrome(env(), deps)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(deps.app.addListener).toHaveBeenCalledTimes(2)
    stop2()
    expect(remove).toHaveBeenCalledTimes(2)
    stop() // stale stop is harmless
    expect(remove).toHaveBeenCalledTimes(2)
    expect(listeners).toHaveLength(2)
  })
  it('back_handler_uses_the_latest_navigate_via_ref', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const ref = { current: first as (to: string | number) => void }
    const { deps, listeners } = fakeDeps()
    cleanups.push(await startNativeChrome({ ...env(), ...backEnvFromRef(ref, () => '/mailbox', () => true) }, deps))
    ref.current = second // route change: React hands out a new navigate
    listeners[0]()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(-1)
  })
})
