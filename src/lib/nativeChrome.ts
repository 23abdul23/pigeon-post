// Android-only chrome: the hardware Back button, the `native-app` CSS hook (safe areas) and the status bar.
// Everything with a side effect is only started when `isNativeApp()`; the pure decisions live here so they can be tested.

export type BackContext = { path: string; flightActive: boolean; dialogOpen: boolean; canGoBack: boolean }
export type BackAction = 'close-dialog' | 'confirm-end-flight' | 'navigate-back' | 'exit-app'

/** What hardware Back should do. Dialog first; a running flight asks before ending; the app exits only from /home with nowhere to go back to. */
export function decideBack(c: BackContext): BackAction {
  if (c.dialogOpen) return 'close-dialog'
  if (c.flightActive) return 'confirm-end-flight'
  if (c.canGoBack) return 'navigate-back'
  return c.path === '/home' ? 'exit-app' : 'navigate-back' // elsewhere the executor sends the user to /home
}

/** Marks the document as the installed app so `.native-app` CSS applies (safe-area insets, no centred-column cap). */
export function applyNativeClasses(root: { classList: { add(c: string): void } }): void {
  root.classList.add('native-app')
}

/** Status bar colours: cream, matching the theme-color in index.html, with dark icons. */
export const STATUS_BAR_COLOR = '#fff8f4'

// --- registry of open modal dialogs and the flight screen's end-flight prompt ---

const dialogs: Array<() => void> = []
let endFlightPrompt: (() => void) | undefined

/** Registers an open dialog (most recent is closed first by Back). Returns the unregister function. */
export function registerDialog(close: () => void): () => void {
  const entry = () => close()
  dialogs.push(entry)
  return () => {
    const i = dialogs.indexOf(entry)
    if (i >= 0) dialogs.splice(i, 1)
  }
}

export function dialogOpen(): boolean {
  return dialogs.length > 0
}

/** Closes the most recently opened dialog; false if none was open. */
export function closeTopDialog(): boolean {
  const top = dialogs[dialogs.length - 1]
  if (!top) return false
  top()
  return true
}

/** The flight screen registers how to show its "Land here?" confirm. Returns the unregister function. */
export function registerEndFlightPrompt(show: () => void): () => void {
  endFlightPrompt = show
  return () => {
    if (endFlightPrompt === show) endFlightPrompt = undefined
  }
}

export type BackEnv = {
  path: () => string
  canGoBack: () => boolean
  navigate: (to: string | number) => void
  exitApp: () => void
}

/** Runs one hardware Back press. Pure of Capacitor so it is testable; the listener in `startNativeChrome` calls it. */
export function handleBack(env: BackEnv): BackAction {
  const path = env.path()
  const flightActive = path.startsWith('/fly/') && endFlightPrompt !== undefined
  const canGoBack = env.canGoBack()
  const action = decideBack({ path, flightActive, dialogOpen: dialogOpen(), canGoBack })
  if (action === 'close-dialog') closeTopDialog()
  else if (action === 'confirm-end-flight') endFlightPrompt?.()
  else if (action === 'navigate-back') env.navigate(canGoBack ? -1 : '/home')
  else env.exitApp()
  return action
}

/** Native only: class hook, status bar, Back listener. Returns a cleanup. Every failure is swallowed. */
export async function startNativeChrome(env: Omit<BackEnv, 'exitApp'>): Promise<() => void> {
  applyNativeClasses(document.documentElement)
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setOverlaysWebView({ overlay: false })
    await StatusBar.setBackgroundColor({ color: STATUS_BAR_COLOR })
    await StatusBar.setStyle({ style: Style.Light }) // Light = dark icons for a light background
  } catch {
    /* cosmetic only */
  }
  try {
    const { App } = await import('@capacitor/app')
    const handle = await App.addListener('backButton', () => {
      handleBack({ ...env, exitApp: () => void App.exitApp() })
    })
    return () => void handle.remove()
  } catch {
    return () => {}
  }
}
