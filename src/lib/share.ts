// Sharing and speech capability helpers. Every platform call is injected (`ShareDeps`) so the logic is testable and the web bundle
// never runs Capacitor code; `liveShareDeps` is the one place that adapts the real plugins, and it only imports them natively.
import { isNativeApp } from './platform'

export const SHARE_IMAGE_FILE = 'pigeon-post.png'
export const SHARE_IMAGE_SAVED_MSG = 'Image saved. Open Instagram and pick it from your gallery.'

export type ShareDeps = {
  native: boolean
  nativeShare?: (o: { title: string; text?: string; url?: string; files?: string[] }) => Promise<void>
  writeTemp?: (name: string, base64: string) => Promise<string>
  webShare?: (d: ShareData) => Promise<void>
}

/** The user dismissing the share sheet is not a failure: web rejects with AbortError, Capacitor with "Share canceled".
 *  Any other error, even one whose message says "canceled", is a real failure. */
function isCancel(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null
  return err?.name === 'AbortError' || /share cancell?ed/i.test(err?.message ?? '')
}

export type ShareResult = 'shared' | 'canceled' | 'unsupported'

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** 'canceled' when the person dismissed the sheet: callers stay silent and offer no fall-back. */
async function guarded(run: () => Promise<void>): Promise<'shared' | 'canceled'> {
  try {
    await run()
  } catch (e) {
    if (!isCancel(e)) throw e
    return 'canceled'
  }
  return 'shared'
}

export async function shareImage(png: Blob, title: string, d: ShareDeps): Promise<ShareResult> {
  if (d.native) {
    const { nativeShare, writeTemp } = d
    if (!nativeShare || !writeTemp) return 'unsupported'
    return guarded(async () => {
      const uri = await writeTemp(SHARE_IMAGE_FILE, toBase64(await png.arrayBuffer()))
      await nativeShare({ title, files: [uri] })
    })
  }
  const { webShare } = d
  if (!webShare) return 'unsupported'
  const file = new File([png], SHARE_IMAGE_FILE, { type: 'image/png' })
  if (typeof navigator !== 'undefined' && navigator.canShare && !navigator.canShare({ files: [file] })) return 'unsupported'
  return guarded(() => webShare({ title, files: [file] }))
}

export async function shareLink(o: { title: string; text?: string; url?: string }, d: ShareDeps): Promise<ShareResult> {
  if (d.native) {
    const { nativeShare } = d
    return nativeShare ? guarded(() => nativeShare(o)) : 'unsupported'
  }
  const { webShare } = d
  return webShare ? guarded(() => webShare(o)) : 'unsupported'
}

/** Real dependencies for the current platform. Capacitor plugins are imported only inside the native app. */
export function liveShareDeps(): ShareDeps {
  if (isNativeApp()) {
    return {
      native: true,
      nativeShare: async (o) => {
        const { Share } = await import('@capacitor/share')
        await Share.share(o)
      },
      writeTemp: async (name, data) => {
        const { Filesystem, Directory } = await import('@capacitor/filesystem')
        return (await Filesystem.writeFile({ path: name, data, directory: Directory.Cache })).uri
      },
    }
  }
  return { native: false, webShare: typeof navigator !== 'undefined' && navigator.share ? (d) => navigator.share(d) : undefined }
}

/** Dictation needs the Web Speech API, which Android WebViews (UA contains "; wv)") do not implement even if a stub exists. */
export function speechAvailable(w: object): boolean {
  const g = w as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown; navigator?: { userAgent?: string } }
  if (!g.SpeechRecognition && !g.webkitSpeechRecognition) return false
  return !(g.navigator?.userAgent ?? '').includes('; wv)')
}
