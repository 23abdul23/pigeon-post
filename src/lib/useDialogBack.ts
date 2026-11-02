import { useEffect, useRef } from 'react'
import { registerDialog } from './nativeChrome'

/** While `open`, hardware Back (Android app) calls `close` instead of leaving the screen. No effect on the web. */
export function useDialogBack(open: boolean, close: () => void): void {
  const ref = useRef(close)
  useEffect(() => {
    ref.current = close
  })
  useEffect(() => {
    if (!open) return
    return registerDialog(() => ref.current())
  }, [open])
}
