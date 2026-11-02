import { describe, expect, it, vi } from 'vitest'
import { shareImage, shareLink, speechAvailable } from '../src/lib/share'

const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

describe('shareImage', () => {
  it('native_image_share_writes_file_then_shares_its_uri', async () => {
    const writeTemp = vi.fn(async () => 'file:///cache/pigeon-post.png')
    const nativeShare = vi.fn(async () => {})
    const r = await shareImage(png, 'My journeys', { native: true, writeTemp, nativeShare })
    expect(r).toBe('shared')
    expect(writeTemp).toHaveBeenCalledTimes(1)
    const [name, b64] = writeTemp.mock.calls[0] as unknown as [string, string]
    expect(name).toMatch(/\.png$/)
    expect(b64).toBe('iVBORw==')
    expect(nativeShare).toHaveBeenCalledWith({ title: 'My journeys', files: ['file:///cache/pigeon-post.png'] })
  })

  it('web_image_share_passes_a_png_file', async () => {
    const webShare = vi.fn(async () => {})
    const r = await shareImage(png, 'My journeys', { native: false, webShare })
    expect(r).toBe('shared')
    const arg = (webShare.mock.calls[0] as unknown as [ShareData])[0]
    expect(arg.title).toBe('My journeys')
    expect(arg.files).toHaveLength(1)
    expect(arg.files![0].type).toBe('image/png')
    expect(arg.files![0].name).toMatch(/\.png$/)
  })

  it('no_share_capability_returns_unsupported', async () => {
    expect(await shareImage(png, 't', { native: false })).toBe('unsupported')
    expect(await shareImage(png, 't', { native: true })).toBe('unsupported')
    expect(await shareLink({ title: 't', url: 'https://x.test' }, { native: false })).toBe('unsupported')
  })

  it('user_cancel_is_not_an_error', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' })
    expect(await shareImage(png, 't', { native: false, webShare: async () => { throw abort } })).toBe('canceled')
    const writeTemp = async () => 'file:///a.png'
    for (const msg of ['Share canceled', 'Share cancelled', 'share Canceled']) {
      const nativeShare = async () => { throw new Error(msg) }
      expect(await shareImage(png, 't', { native: true, writeTemp, nativeShare })).toBe('canceled')
      expect(await shareLink({ title: 't', url: 'u' }, { native: true, nativeShare })).toBe('canceled')
    }
  })

  it('a_non_share_error_containing_canceled_is_not_swallowed', async () => {
    const writeTemp = async () => { throw new Error('Write canceled: disk full') }
    const nativeShare = vi.fn(async () => {})
    await expect(shareImage(png, 't', { native: true, writeTemp, nativeShare })).rejects.toThrow('Write canceled')
    await expect(shareLink({ title: 't' }, { native: true, nativeShare: async () => { throw new Error('Request canceled') } })).rejects.toThrow('Request canceled')
  })
})

describe('speechAvailable', () => {
  const chromeUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'
  const wvUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'

  it('speechAvailable_false_in_android_webview', () => {
    expect(speechAvailable({ webkitSpeechRecognition: function () {}, navigator: { userAgent: wvUa } })).toBe(false)
  })
  it('speechAvailable_true_in_chrome_with_api', () => {
    expect(speechAvailable({ webkitSpeechRecognition: function () {}, navigator: { userAgent: chromeUa } })).toBe(true)
    expect(speechAvailable({ SpeechRecognition: function () {}, navigator: { userAgent: chromeUa } })).toBe(true)
  })
  it('speechAvailable_false_without_api', () => {
    expect(speechAvailable({ navigator: { userAgent: chromeUa } })).toBe(false)
  })
})
