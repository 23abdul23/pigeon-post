// A looping, practically inaudible audio track that is really playing: Chrome then shows a media notification on the lock
// screen (Media Session) and does not throttle or freeze the tab while the screen is off.

export type KeepAliveMeta = { title: string; artist?: string; artworkUrl?: string }

/** RIFF/WAVE, mono 16-bit PCM of white noise whose samples never exceed `peak` (a 0..1 fraction of full scale). */
export function makeQuietWav(seconds: number, sampleRate: number, peak: number): Uint8Array<ArrayBuffer> {
  const n = Math.round(seconds * sampleRate)
  const out = new Uint8Array(44 + 2 * n)
  const v = new DataView(out.buffer)
  const tag = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  tag(0, 'RIFF')
  v.setUint32(4, 36 + 2 * n, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  tag(36, 'data')
  v.setUint32(40, 2 * n, true)
  const amp = Math.max(1, Math.floor(peak * 32767))
  let seed = 12345
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0 // deterministic LCG
    v.setInt16(44 + 2 * i, Math.round(((seed >>> 8) / 0x7fffff - 1) * amp), true)
  }
  return out
}

let el: HTMLAudioElement | null = null
let active = false
let releaseTimer: ReturnType<typeof setTimeout> | undefined

const session = () => (typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null)

export function isKeepAliveActive(): boolean {
  return active
}

export function setKeepAliveMeta(meta: KeepAliveMeta): void {
  const ms = session()
  if (!ms || typeof MediaMetadata === 'undefined') return
  try {
    ms.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist ?? '',
      album: 'Pigeon Post',
      artwork: [{ src: meta.artworkUrl ?? '/assets/logo.jpg', sizes: '512x512', type: 'image/jpeg' }],
    })
  } catch {
    // metadata is cosmetic
  }
}

/** Chrome extrapolates the progress bar itself: call on a slot change or the 30 s heartbeat only. */
export function setKeepAlivePosition(durationSec: number, positionSec: number): void {
  try {
    if (!(durationSec > 0)) return
    session()?.setPositionState({ duration: durationSec, position: Math.min(durationSec, Math.max(0, positionSec)), playbackRate: 1 })
  } catch {
    // unsupported
  }
}

export async function startKeepAlive(meta: KeepAliveMeta): Promise<boolean> {
  clearTimeout(releaseTimer)
  try {
    if (typeof Audio === 'undefined') return false
    if (!el) {
      const a = new Audio(URL.createObjectURL(new Blob([makeQuietWav(8, 8000, 0.00126)], { type: 'audio/wav' }))) // about -58 dBFS
      a.loop = true
      ;(a as HTMLVideoElement).playsInline = true
      a.addEventListener?.('play', () => (active = true))
      a.addEventListener?.('pause', () => (active = false))
      a.addEventListener?.('ended', () => (active = false))
      el = a
    }
    setKeepAliveMeta(meta)
    const ms = session()
    if (ms) {
      ms.playbackState = 'playing'
      // the lock-screen buttons must not desynchronise the app: both just keep playing
      for (const act of ['play', 'pause'] as const) ms.setActionHandler(act, () => void el?.play().catch(() => {}))
    }
    await el.play()
    active = true
    return true
  } catch {
    active = false
    return false
  }
}

/** Cancels a pending release, then starts only if the audio is not already playing. Resolves true when it plays. */
export async function ensureKeepAlive(meta: KeepAliveMeta): Promise<boolean> {
  clearTimeout(releaseTimer)
  return active ? true : startKeepAlive(meta)
}

/** Stops after `graceMs` unless a start comes first: a chained slot briefly has no session and must not kill the audio. */
export function releaseKeepAlive(graceMs = 2000): void {
  clearTimeout(releaseTimer)
  releaseTimer = setTimeout(stopKeepAlive, graceMs)
}

export function stopKeepAlive(): void {
  clearTimeout(releaseTimer)
  active = false
  try {
    el?.pause()
    const ms = session()
    if (ms) {
      ms.metadata = null
      ms.playbackState = 'none'
      for (const act of ['play', 'pause'] as const) ms.setActionHandler(act, null)
    }
  } catch {
    // nothing to stop
  }
}

