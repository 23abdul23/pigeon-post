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

function tone(c: AudioContext, start: number, from: number, to: number, dur: number, gain = 0.08, attack = 0.03) {
  gain = Math.max(0.0002, gain) // exponential ramps cannot target 0
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(from, start)
  o.frequency.exponentialRampToValueAtTime(to, start + dur)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + attack)
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

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

/** Quiet wind bed plus sparse bird phrases while flying. Returns a stop function; silent when muted or ambience is off. */
export function startAmbience(): () => void {
  const { soundOn, settings } = getState()
  if (!soundOn || !settings.ambience) return () => {}
  const c = audio()
  if (!c) return () => {}
  void c.resume()
  const vol = () => getState().settings.volume / 100

  const len = c.sampleRate * 2
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const bed = c.createBufferSource()
  bed.buffer = buf
  bed.loop = true
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 500
  const bg = c.createGain()
  bg.gain.value = 0.02 * vol()
  bed.connect(lp).connect(bg).connect(c.destination)
  bed.start()

  let timer: ReturnType<typeof setTimeout>
  const phrase = () => {
    const t = c.currentTime
    let at = t
    const notes = Math.floor(rnd(2, 6))
    for (let i = 0; i < notes; i++) {
      const dur = rnd(0.06, 0.14)
      const from = rnd(2000, 4200)
      const to = Math.min(4200, Math.max(2000, from * (1 + rnd(-0.15, 0.15))))
      tone(c, at, from, to, dur, 0.05 * vol(), 0.015)
      at += dur + rnd(0.03, 0.08)
    }
    timer = setTimeout(phrase, rnd(1500, 5000))
  }
  timer = setTimeout(phrase, rnd(1500, 5000))

  return () => {
    clearTimeout(timer)
    const t = c.currentTime
    bg.gain.setValueAtTime(bg.gain.value, t)
    bg.gain.linearRampToValueAtTime(0, t + 0.3)
    bed.stop(t + 0.3)
  }
}
