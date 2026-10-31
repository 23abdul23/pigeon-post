import { afterEach, describe, expect, it, vi } from 'vitest'
import { closePopup, copyStyles, getPopup, openPopup, popupSupported, resizePopup } from '../src/lib/pip'

const DESKTOP = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36', maxTouchPoints: 0 }

function fakeWindow(opts: { resizeFails?: boolean } = {}) {
  const win = Object.assign(new EventTarget(), {
    document: { head: { appendChild: vi.fn() }, querySelectorAll: () => [] },
    close: vi.fn(),
    resizeTo: vi.fn(() => {
      if (opts.resizeFails) throw new Error('NotAllowedError')
    }),
  })
  return win
}

afterEach(() => {
  closePopup()
  vi.unstubAllGlobals()
})

describe('popup (Document Picture-in-Picture)', () => {
  it('openPopup resolves null and does not throw when documentPictureInPicture is missing', async () => {
    vi.stubGlobal('navigator', DESKTOP)
    expect(popupSupported()).toBe(false)
    await expect(openPopup()).resolves.toBeNull()
  })

  it('openPopup resolves null when requestWindow rejects', async () => {
    vi.stubGlobal('navigator', DESKTOP)
    vi.stubGlobal('documentPictureInPicture', { requestWindow: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) })
    await expect(openPopup()).resolves.toBeNull()
    expect(getPopup()).toBeNull()
  })

  it('openPopup returns the same window on a second call and requests only once', async () => {
    vi.stubGlobal('navigator', DESKTOP)
    vi.stubGlobal('document', { querySelectorAll: () => [] })
    const win = fakeWindow()
    const requestWindow = vi.fn(async () => win)
    vi.stubGlobal('documentPictureInPicture', { requestWindow })
    const [a, b] = await Promise.all([openPopup(), openPopup()])
    expect(a).toBe(win)
    expect(b).toBe(win)
    expect(await openPopup()).toBe(win)
    expect(requestWindow).toHaveBeenCalledTimes(1)
    expect(requestWindow).toHaveBeenCalledWith({ width: 320, height: 420 })
  })

  it('getPopup is null after the window fires pagehide', async () => {
    vi.stubGlobal('navigator', DESKTOP)
    vi.stubGlobal('document', { querySelectorAll: () => [] })
    const win = fakeWindow()
    vi.stubGlobal('documentPictureInPicture', { requestWindow: async () => win })
    await openPopup()
    expect(getPopup()).toBe(win)
    win.dispatchEvent(new Event('pagehide'))
    expect(getPopup()).toBeNull()
  })

  it('resizePopup returns false when resizeTo throws, true when it succeeds', async () => {
    vi.stubGlobal('navigator', DESKTOP)
    vi.stubGlobal('document', { querySelectorAll: () => [] })
    expect(resizePopup({ width: 1, height: 1 })).toBe(false) // no popup
    const bad = fakeWindow({ resizeFails: true })
    vi.stubGlobal('documentPictureInPicture', { requestWindow: async () => bad })
    await openPopup()
    expect(resizePopup({ width: 440, height: 600 })).toBe(false)
    closePopup()
    const good = fakeWindow()
    vi.stubGlobal('documentPictureInPicture', { requestWindow: async () => good })
    await openPopup()
    expect(resizePopup({ width: 440, height: 600 })).toBe(true)
    expect(good.resizeTo).toHaveBeenCalledWith(440, 600)
  })

  it('copyStyles clones each stylesheet node into the target head', () => {
    const nodes = [{ cloneNode: vi.fn(() => 'a') }, { cloneNode: vi.fn(() => 'b') }]
    const from = { querySelectorAll: vi.fn(() => nodes) } as unknown as Document
    const appendChild = vi.fn()
    const to = { head: { appendChild } } as unknown as Document
    copyStyles(from, to)
    expect(from.querySelectorAll).toHaveBeenCalledWith('link[rel="stylesheet"], style')
    expect(appendChild.mock.calls).toEqual([['a'], ['b']])
  })

  it('popupSupported is false for a mobile user agent', () => {
    vi.stubGlobal('documentPictureInPicture', {})
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile Safari/537.36', maxTouchPoints: 5 })
    expect(popupSupported()).toBe(false)
    vi.stubGlobal('navigator', DESKTOP)
    expect(popupSupported()).toBe(true)
  })
})
