import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPresence, DECIDE_MS, isMobileDevice, UNLOCK_GRACE_MS } from '../src/lib/presence'
import type { ScreenState } from '../src/lib/idle'

// A fake page: EventTargets plus the two fields the controller reads, driven by hand.
function setup(opts: { mobile: boolean; screen?: ScreenState; audio?: boolean; pip?: boolean }) {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', focused: true, hasFocus() { return this.focused } })
  const win = new EventTarget()
  let screen: ScreenState = opts.screen ?? 'unknown'
  const subs = new Set<(s: ScreenState) => void>()
  const left: number[] = []
  let clock = 1_000_000
  const p = createPresence({
    doc,
    win,
    mobile: opts.mobile,
    screen: () => screen,
    onScreen: (cb) => (subs.add(cb), () => subs.delete(cb)),
    keepAliveActive: () => !!opts.audio,
    pipActive: opts.pip === undefined ? undefined : () => opts.pip!,
    onLeave: (at) => left.push(at),
    now: () => clock,
  })
  return {
    p,
    left,
    tick: (ms: number) => ((clock += ms), vi.advanceTimersByTime(ms)),
    hide: () => ((doc.visibilityState = 'hidden'), doc.dispatchEvent(new Event('visibilitychange'))),
    show: () => ((doc.visibilityState = 'visible'), doc.dispatchEvent(new Event('visibilitychange'))),
    blur: () => ((doc.focused = false), win.dispatchEvent(new Event('blur'))),
    focus: () => ((doc.focused = true), win.dispatchEvent(new Event('focus'))),
    pagehide: () => win.dispatchEvent(new Event('pagehide')),
    setScreen: (s: ScreenState) => ((screen = s), subs.forEach((cb) => cb(s))),
    clock: () => clock,
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('mobile with the screen-lock signal (Chrome Idle Detection)', () => {
  it('locking the screen keeps flying', () => {
    const t = setup({ mobile: true, screen: 'unlocked' })
    t.setScreen('locked')
    t.hide()
    t.tick(DECIDE_MS + 1)
    expect(t.left).toEqual([])
    expect(t.p.state()).toBe('locked')
  })

  it('a lock report that trails the hidden event by a second still counts as a lock', () => {
    const t = setup({ mobile: true, screen: 'unlocked' })
    t.hide()
    t.tick(1000)
    t.setScreen('locked')
    t.tick(DECIDE_MS)
    expect(t.left).toEqual([])
    expect(t.p.state()).toBe('locked')
  })

  it('switching to another app (screen stays unlocked) leaves, dated at the moment it was hidden', () => {
    const t = setup({ mobile: true, screen: 'unlocked' })
    const hiddenAt = t.clock()
    t.hide()
    t.tick(DECIDE_MS + 1)
    expect(t.left).toEqual([hiddenAt])
    expect(t.p.state()).toBe('left')
  })

  it('locking then unlocking into another app leaves at the unlock', () => {
    const t = setup({ mobile: true, screen: 'unlocked' })
    t.setScreen('locked')
    t.hide()
    t.tick(DECIDE_MS + 1)
    expect(t.p.state()).toBe('locked')
    t.tick(60_000)
    const unlockedAt = t.clock()
    t.setScreen('unlocked') // the page is still hidden: the person opened something else
    t.tick(UNLOCK_GRACE_MS + 1)
    expect(t.left).toEqual([unlockedAt])
  })

  it('unlocking straight back to this page is not leaving', () => {
    const t = setup({ mobile: true, screen: 'unlocked' })
    t.setScreen('locked')
    t.hide()
    t.tick(DECIDE_MS + 1)
    t.setScreen('unlocked')
    t.show() // visibility returns right after the unlock event
    t.tick(UNLOCK_GRACE_MS + 1)
    expect(t.left).toEqual([])
    expect(t.p.state()).toBe('present')
  })

  it('a short visit to another app that returns before the decision is not leaving', () => {
    const t = setup({ mobile: true, screen: 'unlocked' })
    t.hide()
    t.tick(DECIDE_MS - 500)
    t.show()
    t.tick(5000)
    expect(t.left).toEqual([])
  })

  it('window focus is ignored on a phone (keyboard, URL bar, dialogs blur the window)', () => {
    const t = setup({ mobile: true, screen: 'unlocked' })
    t.blur()
    t.tick(DECIDE_MS * 4)
    expect(t.left).toEqual([])
  })
})

describe('mobile without the signal (iOS Safari, permission refused)', () => {
  it('a hidden page whose keep-alive audio plays counts as a locked screen: it keeps flying', () => {
    const t = setup({ mobile: true, audio: true })
    t.hide()
    t.tick(DECIDE_MS + 1)
    expect(t.left).toEqual([])
    expect(t.p.state()).toBe('locked')
  })

  it('a hidden page with no audio is leaving', () => {
    const t = setup({ mobile: true, audio: false })
    t.hide()
    t.tick(DECIDE_MS + 1)
    expect(t.left.length).toBe(1)
  })
})

describe('desktop', () => {
  it('switching tab or minimising (page hidden, screen unlocked) leaves', () => {
    const t = setup({ mobile: false, screen: 'unlocked' })
    t.hide()
    t.tick(DECIDE_MS + 1)
    expect(t.left.length).toBe(1)
  })

  it('another window taking focus while this page stays visible leaves after the grace', () => {
    const t = setup({ mobile: false, screen: 'unlocked' })
    t.blur()
    t.tick(DECIDE_MS + 1)
    expect(t.left.length).toBe(1)
  })

  it('a blip of lost focus (address bar, permission prompt) is ignored', () => {
    const t = setup({ mobile: false, screen: 'unlocked' })
    t.blur()
    t.tick(1000)
    t.focus()
    t.tick(10_000)
    expect(t.left).toEqual([])
  })

  it('a locked or sleeping computer keeps flying when the lock is reported', () => {
    const t = setup({ mobile: false, screen: 'unlocked' })
    t.setScreen('locked')
    t.hide()
    t.blur()
    t.tick(DECIDE_MS + 1)
    expect(t.left).toEqual([])
    expect(t.p.state()).toBe('locked')
  })

  it('without the signal a hidden tab is leaving even while the keep-alive audio plays', () => {
    const t = setup({ mobile: false, audio: true })
    t.hide()
    t.tick(DECIDE_MS + 1)
    expect(t.left.length).toBe(1)
  })
})

describe('desktop with the flight popup (Document Picture-in-Picture)', () => {
  it('desktop with the popup open: hiding the page does not leave', () => {
    const t = setup({ mobile: false, screen: 'unlocked', pip: true })
    t.hide()
    t.tick(DECIDE_MS + 100)
    expect(t.left).toEqual([])
    expect(t.p.state()).toBe('present')
  })

  it('desktop with the popup open: window blur does not leave', () => {
    const t = setup({ mobile: false, screen: 'unlocked', pip: true })
    t.blur()
    t.tick(DECIDE_MS + 100)
    expect(t.left).toEqual([])
  })

  it('popup closed while the page is hidden: a fresh controller leaves after DECIDE_MS', () => {
    // the Focus effect rebuilds the controller when the popup closes; the hidden page is then away again
    const t = setup({ mobile: false, screen: 'unlocked', pip: true })
    t.hide()
    t.tick(1000)
    t.p.stop()
    const doc = { visibilityState: 'hidden', hasFocus: () => false, addEventListener() {}, removeEventListener() {} }
    const left: number[] = []
    createPresence({ doc, win: new EventTarget(), mobile: false, screen: () => 'unlocked', onScreen: () => () => {}, keepAliveActive: () => false, pipActive: () => false, onLeave: (at) => left.push(at) })
    vi.advanceTimersByTime(DECIDE_MS)
    expect(left.length).toBe(1)
  })

  it('without pipActive behaviour is unchanged', () => {
    const t = setup({ mobile: false, screen: 'unlocked' })
    t.hide()
    t.tick(DECIDE_MS + 1)
    expect(t.left.length).toBe(1)
  })
})

describe('closing and cleaning up', () => {
  it('closing the page leaves at once, unless the screen is locked', () => {
    const open = setup({ mobile: true, screen: 'unlocked' })
    open.pagehide()
    expect(open.left.length).toBe(1)

    const locked = setup({ mobile: true, screen: 'unlocked' })
    locked.setScreen('locked')
    locked.hide()
    locked.tick(DECIDE_MS + 1)
    locked.pagehide()
    expect(locked.left).toEqual([])
  })

  it('leaves only once, and stop() removes every listener and timer', () => {
    const t = setup({ mobile: false, screen: 'unlocked' })
    t.hide()
    t.blur()
    t.tick(DECIDE_MS + 1)
    t.pagehide()
    expect(t.left.length).toBe(1)

    const u = setup({ mobile: false, screen: 'unlocked' })
    u.hide()
    u.p.stop()
    u.tick(DECIDE_MS * 3)
    expect(u.left).toEqual([])
  })
})

describe('isMobileDevice', () => {
  it('recognises phones, tablets and iPadOS (which reports a Mac)', () => {
    const nav = (userAgent: string, maxTouchPoints = 0, userAgentData?: { mobile: boolean }) => ({ userAgent, maxTouchPoints, userAgentData })
    expect(isMobileDevice(nav('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile Safari/537.36'))).toBe(true)
    expect(isMobileDevice(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1'))).toBe(true)
    expect(isMobileDevice(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 5))).toBe(true)
    expect(isMobileDevice(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36', 0, { mobile: false }))).toBe(false)
    expect(isMobileDevice(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 0))).toBe(false)
  })
})
