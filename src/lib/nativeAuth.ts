import type { INavigator } from 'oidc-client-ts'
import { isAuthCallbackUrl, isSignOutUrl } from './authUrls'

export type BrowserLike = { open(o: { url: string }): Promise<void>; close(): Promise<void> }
export type UrlOpenSource = { onUrlOpen(cb: (url: string) => void): () => void }

/** An oidc-client-ts navigator that shows the sign-in page in a Custom Tab. Like a redirect, navigate never settles:
 *  the app finishes sign-in when the deep link brings it back. */
export function createBrowserNavigator(browser: BrowserLike): INavigator {
  return {
    async prepare() {
      return {
        navigate: ({ url }) => {
          void browser.open({ url })
          return new Promise(() => {})
        },
        close: () => void browser.close().catch(() => {}),
      }
    },
    async callback() {},
  }
}

/** Completes sign-in for each distinct callback deep link, then routes; any failure routes to /signin.
 *  The sign-out deep link (Cognito's logout redirect) closes the browser and routes to /signin. */
export function startAuthListener(
  src: UrlOpenSource,
  finish: (url: string) => Promise<string>,
  go: (to: string) => void,
  browser: BrowserLike,
): () => void {
  const seen = new Set<string>()
  return src.onUrlOpen((url) => {
    if (isSignOutUrl(url)) {
      void (async () => {
        await browser.close().catch(() => {})
        go('/signin')
      })()
      return
    }
    if (!isAuthCallbackUrl(url) || seen.has(url)) return
    seen.add(url)
    void (async () => {
      await browser.close().catch(() => {}) // the tab may already be gone
      try {
        go(await finish(url))
      } catch {
        go('/signin')
      }
    })()
  })
}
