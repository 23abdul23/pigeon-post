import { describe, expect, it, vi } from 'vitest'
import { createBrowserNavigator, startAuthListener, type BrowserLike } from '../src/lib/nativeAuth'

const CB = 'app.pigeonpost://auth/callback?code=abc&state=s'

function fakeBrowser(log: string[] = []) {
  return {
    open: vi.fn(async (o: { url: string }) => void log.push(`open:${o.url}`)),
    close: vi.fn(async () => void log.push('close')),
  } satisfies BrowserLike
}

function fakeSource() {
  let cb: (url: string) => void = () => {}
  const off = vi.fn()
  return { src: { onUrlOpen: (c: (url: string) => void) => ((cb = c), off) }, emit: (u: string) => cb(u), off }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('browser navigator', () => {
  it('navigator_navigate_opens_the_browser_with_the_signin_url', async () => {
    const b = fakeBrowser()
    const w = await createBrowserNavigator(b).prepare({} as never)
    void w.navigate({ url: 'https://idp/authorize?x=1' } as never)
    await flush()
    expect(b.open).toHaveBeenCalledWith({ url: 'https://idp/authorize?x=1' })
  })
  it('navigator_navigate_never_resolves', async () => {
    const w = await createBrowserNavigator(fakeBrowser()).prepare({} as never)
    const winner = await Promise.race([w.navigate({ url: 'https://idp' } as never).then(() => 'navigate'), Promise.resolve('other')])
    await flush()
    expect(winner).toBe('other')
  })
  it('navigator_window_close_closes_the_browser', async () => {
    const b = fakeBrowser()
    const w = await createBrowserNavigator(b).prepare({} as never)
    w.close()
    expect(b.close).toHaveBeenCalled()
  })
})

describe('auth listener', () => {
  it('listener_goes_to_signin_when_the_signout_link_arrives', async () => {
    const { src, emit } = fakeSource()
    const finish = vi.fn(async () => '/home')
    const log: string[] = []
    const go = vi.fn((to: string) => void log.push(`go:${to}`))
    startAuthListener(src, finish, go, fakeBrowser(log))
    emit('app.pigeonpost://signin')
    await flush()
    expect(finish).not.toHaveBeenCalled()
    expect(log).toEqual(['close', 'go:/signin'])
    emit('app.pigeonpost://signin') // a second sign-out later in the same session is handled too
    await flush()
    expect(go).toHaveBeenCalledTimes(2)
  })
  it('listener_goes_to_signin_on_signout_even_when_browser_close_rejects', async () => {
    const { src, emit } = fakeSource()
    const go = vi.fn()
    const b = fakeBrowser()
    b.close.mockRejectedValueOnce(new Error('no tab'))
    startAuthListener(src, vi.fn(), go, b)
    emit('app.pigeonpost://signin')
    await flush()
    expect(go).toHaveBeenCalledWith('/signin')
  })
  it('listener_ignores_non_callback_urls', async () => {
    const { src, emit } = fakeSource()
    const finish = vi.fn(async () => '/home')
    startAuthListener(src, finish, vi.fn(), fakeBrowser())
    emit('app.pigeonpost://other')
    emit('https://example.com/auth/callback?code=1')
    await flush()
    expect(finish).not.toHaveBeenCalled()
  })
  it('listener_finishes_once_for_a_duplicate_url', async () => {
    const { src, emit } = fakeSource()
    const finish = vi.fn(async () => '/home')
    const go = vi.fn()
    startAuthListener(src, finish, go, fakeBrowser())
    emit(CB)
    emit(CB)
    await flush()
    emit(CB)
    await flush()
    expect(finish).toHaveBeenCalledTimes(1)
    expect(go).toHaveBeenCalledTimes(1)
  })
  it('listener_closes_browser_then_navigates_to_returned_path', async () => {
    const log: string[] = []
    const { src, emit } = fakeSource()
    startAuthListener(src, async (u) => (log.push(`finish:${u}`), '/journal'), (to) => log.push(`go:${to}`), fakeBrowser(log))
    emit(CB)
    await flush()
    expect(log).toEqual(['close', `finish:${CB}`, 'go:/journal'])
  })
  it('listener_goes_to_signin_when_finish_rejects', async () => {
    const { src, emit } = fakeSource()
    const go = vi.fn()
    startAuthListener(src, async () => { throw new Error('bad code') }, go, fakeBrowser())
    emit(CB)
    await flush()
    expect(go).toHaveBeenCalledWith('/signin')
  })
  it('listener_goes_to_signin_when_browser_close_rejects', async () => {
    const { src, emit } = fakeSource()
    const go = vi.fn()
    const b = fakeBrowser()
    b.close.mockRejectedValue(new Error('no browser'))
    startAuthListener(src, async () => '/home', go, b)
    emit(CB)
    await flush()
    expect(go).toHaveBeenCalledWith('/home')
  })
  it('listener_stop_function_unsubscribes', () => {
    const { src, off } = fakeSource()
    const stop = startAuthListener(src, async () => '/home', vi.fn(), fakeBrowser())
    stop()
    expect(off).toHaveBeenCalled()
  })
})
