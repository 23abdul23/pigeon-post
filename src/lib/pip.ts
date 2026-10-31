// The flight popup: a Document Picture-in-Picture window (Chrome / Edge desktop). It is an always-on-top native window the
// person drags and resizes freely, which no in-page element can do across browser tabs. React portals into it (FlightPopup).
// Browsers without `documentPictureInPicture` (Firefox, Safari) and phones get no popup; callers keep today's behaviour.

import { useSyncExternalStore } from 'react'
import { isMobileDevice } from './presence'

export const POPUP_SIZE = { width: 320, height: 420 }
export const CHECKPOINT_SIZE = { width: 440, height: 600 }

type Size = { width: number; height: number }
type PipApi = { requestWindow(opts?: Size): Promise<Window> }

const api = (): PipApi | undefined => (globalThis as { documentPictureInPicture?: PipApi }).documentPictureInPicture

let popup: Window | null = null
let opening: Promise<Window | null> | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function popupSupported(): boolean {
  if (!api()) return false
  try {
    return !isMobileDevice()
  } catch {
    return false
  }
}

export function getPopup(): Window | null {
  return popup
}

export function usePopup(): Window | null {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    getPopup,
    () => null,
  )
}

/** Clones every stylesheet node so the popup renders with the same Tailwind classes as the page. */
export function copyStyles(from: Document, to: Document): void {
  from.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => to.head.appendChild(node.cloneNode(true)))
}

/** Opens the popup, or returns the open one. Resolves `null` (never throws) when unsupported, refused, or without user activation. */
export function openPopup(): Promise<Window | null> {
  if (popup) return Promise.resolve(popup)
  if (opening) return opening
  const pip = popupSupported() ? api() : undefined
  if (!pip) return Promise.resolve(null)
  opening = (async () => {
    try {
      const win = await pip.requestWindow({ width: POPUP_SIZE.width, height: POPUP_SIZE.height })
      try {
        copyStyles(document, win.document)
      } catch {
        // an unstyled popup is still usable
      }
      win.addEventListener('pagehide', () => {
        if (popup === win) {
          popup = null
          emit()
        }
      })
      popup = win
      emit()
      return win
    } catch {
      return null
    } finally {
      opening = null
    }
  })()
  return opening
}

export function closePopup(): void {
  const win = popup
  if (!win) return
  popup = null
  emit()
  try {
    win.close()
  } catch {
    // already gone
  }
}

/** Chrome requires user activation for resizeTo; a refusal leaves the popup at its current size. */
export function resizePopup(size: Size): boolean {
  if (!popup) return false
  try {
    popup.resizeTo(size.width, size.height)
    return true
  } catch {
    return false
  }
}

/**
 * Opens the popup when the person leaves this tab and closes it when they come back (a popup they opened by hand stays).
 * Chrome only lets a page open a Picture-in-Picture window without a click through the `enterpictureinpicture` media-session action,
 * so that is registered too; where neither works the flight simply freezes on leaving, as it always did.
 */
export function watchTabLeave(): () => void {
  if (!popupSupported()) return () => {}
  let auto = false
  const open = () => {
    if (getPopup()) return
    void openPopup().then((w) => {
      if (w && !document.hidden) closePopup() // came back before it opened
      else auto = !!w
    })
  }
  const onVisibility = () => {
    if (document.hidden) open()
    else if (auto) {
      auto = false
      closePopup()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  const action = 'enterpictureinpicture' as MediaSessionAction
  try {
    navigator.mediaSession.setActionHandler(action, open)
  } catch {
    // the action is not supported here
  }
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    try {
      navigator.mediaSession.setActionHandler(action, null)
    } catch {
      // nothing registered
    }
  }
}
