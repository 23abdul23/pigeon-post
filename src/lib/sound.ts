import { getState } from './store'

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    return ctx
  } catch {
    return null
  }
}

function tone(c: AudioContext, start: number, from: number, to: number, dur: number, gain = 0.08) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(from, start)
  o.frequency.exponentialRampToValueAtTime(to, start + dur)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  o.connect(g).connect(c.destination)
  o.start(start)
  o.stop(start + dur + 0.02)
}

/** Soft two-note coo, synthesised so no audio files are needed. Respects the global sound toggle. */
export function playCoo(force = false) {
  const { soundOn, settings } = getState()
  if (!force && (!soundOn || !settings.coo)) return
  const c = audio()
  if (!c) return
  void c.resume()
  const t = c.currentTime
  const g = 0.14 * (settings.volume / 100)
  tone(c, t, 520, 400, 0.22, g)
  tone(c, t + 0.26, 470, 360, 0.3, g)
}

/** Short paper-rustle burst for opening letters. */
export function playRustle() {
  const { soundOn, settings } = getState()
  if (!soundOn || !settings.rustle) return
  const c = audio()
  if (!c) return
  void c.resume()
  const len = Math.floor(c.sampleRate * 0.35)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.25
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'highpass'
  f.frequency.value = 1800
  src.connect(f).connect(c.destination)
  src.start()
}
