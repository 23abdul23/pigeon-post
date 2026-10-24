import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHIPS, LET_H, LET_W, OPENING_MS, SOUND_CUES_MS, UNFOLD, openingSteps, playOpening, readingScale, stageScaleFor, type Animatable, type Step, type Target } from '../src/lib/envelopeOpening'

const steps = openingSteps({ readingScale: 1.3 })
const by = (t: Target): Step => steps.find((s) => s.target === t)!
/** Absolute time (ms) of keyframe i of a step. */
const timeOf = (s: Step, i: number) => Math.round(s.at + (s.keyframes[i].offset as number) * s.ms)
const first = (s: Step, pred: (k: Keyframe) => boolean) => timeOf(s, s.keyframes.findIndex(pred))

describe('opening choreography', () => {
  it('lasts about three and a half seconds and ends with the root fade', () => {
    expect(OPENING_MS).toBeGreaterThan(2500)
    expect(OPENING_MS).toBeLessThanOrEqual(3500)
    const end = (s: Step) => s.at + s.ms
    expect(Math.max(...steps.map(end))).toBe(OPENING_MS)
    expect(end(by('root'))).toBe(OPENING_MS)
  })

  it('animates only transform, opacity, colour and stacking (never layout)', () => {
    const allowed = new Set(['offset', 'easing', 'transform', 'opacity', 'backgroundColor', 'zIndex'])
    for (const s of steps) for (const k of s.keyframes) for (const p of Object.keys(k)) expect(allowed.has(p), `${s.target}.${p}`).toBe(true)
  })

  it('is well formed: one timeline per element, offsets run 0..1 in order', () => {
    const targets = steps.map((s) => s.target)
    expect(new Set(targets).size).toBe(targets.length)
    for (const s of steps) {
      const offs = s.keyframes.map((k) => k.offset as number)
      expect(offs[0], s.target).toBe(0)
      expect(offs[offs.length - 1], s.target).toBe(1)
      expect(offs.every((o, i) => i === 0 || o >= offs[i - 1]), s.target).toBe(true)
      expect(s.ms).toBeGreaterThan(0)
    }
  })

  it('is deterministic: the same letter opens the same way every time', () => {
    expect(openingSteps({ readingScale: 1.3 })).toEqual(openingSteps({ readingScale: 1.3 }))
    expect(CHIPS.length).toBe(6)
  })

  it('plays the beats in order: seal cracks, flap swings, letter slides out, envelope falls away', () => {
    const sealPulse = first(by('sealL'), (k) => String(k.transform).includes('1.08'))
    const crack = first(by('chip0'), (k) => k.opacity === 1)
    const flapBegins = timeOf(by('flap'), 1) // keyframe 0 and 1 are the same closed pose: the swing starts at keyframe 1
    const flapEdgeOn = first(by('flap'), (k) => String(k.transform).includes('-90'))
    const letterShows = first(by('letter'), (k) => k.opacity === 1)
    const letterClear = first(by('letter'), (k) => k.zIndex === 7)
    const envelopeGone = timeOf(by('back'), by('back').keyframes.length - 1)
    expect(sealPulse).toBeLessThan(crack)
    expect(crack).toBeLessThan(flapBegins) // the seal breaks before the flap lifts
    expect(flapBegins).toBeLessThan(flapEdgeOn)
    expect(letterShows).toBeGreaterThanOrEqual(flapEdgeOn) // the letter appears only once the flap is past edge-on
    expect(letterClear).toBeGreaterThan(letterShows)
    expect(envelopeGone).toBeGreaterThan(letterClear)
  })

  it('swings the flap a full 180 degrees and swaps its colour and stacking exactly while it is edge-on', () => {
    const f = by('flap').keyframes
    expect(String(f[f.length - 2].transform)).toContain('rotateX(-180deg)')
    const edgeOn = f.findIndex((k) => String(k.transform).includes('rotateX(-90deg)') && k.backgroundColor === f[0].backgroundColor)
    const swapped = f.findIndex((k) => k.backgroundColor !== f[0].backgroundColor)
    const msBetween = timeOf(by('flap'), swapped) - timeOf(by('flap'), edgeOn)
    expect(msBetween).toBeLessThanOrEqual(2)
    expect(f[0].zIndex).toBeGreaterThan(f[swapped].zIndex as number) // above the pocket when closed, behind the letter when open
    expect(f[swapped].zIndex).toBeLessThan(3) // the letter sits at 3
  })

  it('lifts the letter clear, brings it in front of the envelope, and unfolds it to the reading scale', () => {
    const l = by('letter').keyframes
    const last = l[l.length - 1]
    expect(last.zIndex).toBeGreaterThan(5)
    expect(last.transform).toBe(`translateY(-20px) scale(1.3, ${1.3 * UNFOLD})`)
    const clear = l.find((k) => k.zIndex === 7)!
    expect(String(clear.transform)).toContain('translateY(-176px)')
  })

  it('fades the envelope parts out together', () => {
    for (const t of ['back', 'front', 'flap'] as const) {
      const k = by(t).keyframes
      expect(k[k.length - 1].opacity, t).toBe(0)
      expect(timeOf(by(t), k.length - 1), t).toBe(timeOf(by('back'), by('back').keyframes.length - 1))
    }
  })

  it('cues the paper rustle with the flap and with the letter', () => {
    expect(SOUND_CUES_MS.length).toBe(2)
    expect(SOUND_CUES_MS[0]).toBeLessThan(SOUND_CUES_MS[1])
    expect(SOUND_CUES_MS[1]).toBeLessThan(OPENING_MS)
  })
})

describe('sizing', () => {
  it('scales the design box to the screen within limits', () => {
    expect(stageScaleFor(375)).toBeCloseTo((375 * 0.84) / 300, 5)
    expect(stageScaleFor(200)).toBe(0.75)
    expect(stageScaleFor(2000)).toBe(1.25)
  })

  it('never lets the unfolded sheet overflow a phone or a wide window', () => {
    for (const [w, h] of [[375, 812], [320, 568], [1440, 900], [800, 400]]) {
      const s = stageScaleFor(w)
      const k = readingScale(w, h, s)
      expect(LET_W * k * s, `${w}x${h} width`).toBeLessThanOrEqual(w * 0.9 + 0.01)
      if (k > 0.8) expect(LET_H * UNFOLD * k * s, `${w}x${h} height`).toBeLessThanOrEqual(h * 0.72 + 0.01)
    }
  })
})

describe('playOpening', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function fakes() {
    const calls: { target: Target; keyframes: Keyframe[]; options: KeyframeAnimationOptions; cancelled: boolean }[] = []
    const targets: Partial<Record<Target, Animatable>> = {}
    for (const s of steps) {
      targets[s.target] = {
        animate(keyframes, options) {
          const c = { target: s.target, keyframes, options, cancelled: false }
          calls.push(c)
          return { cancel: () => void (c.cancelled = true) }
        },
      }
    }
    return { calls, targets }
  }

  it('starts every step with its delay and duration and calls onDone once at the end', () => {
    const { calls, targets } = fakes()
    const onDone = vi.fn()
    playOpening(steps, targets, { onDone })
    expect(calls.length).toBe(steps.length)
    const flap = calls.find((c) => c.target === 'flap')!
    expect(flap.options).toMatchObject({ delay: by('flap').at, duration: by('flap').ms, fill: 'both' })
    vi.advanceTimersByTime(OPENING_MS - 1)
    expect(onDone).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(onDone).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('runs sound cues at their times', () => {
    const { targets } = fakes()
    const ran: number[] = []
    playOpening(steps, targets, { onDone: () => {}, cues: SOUND_CUES_MS.map((at) => ({ at, run: () => ran.push(at) })) })
    vi.advanceTimersByTime(SOUND_CUES_MS[0] + 1)
    expect(ran).toEqual([SOUND_CUES_MS[0]])
    vi.advanceTimersByTime(SOUND_CUES_MS[1])
    expect(ran).toEqual([...SOUND_CUES_MS])
  })

  it('skip cancels the animations, fades the overlay quickly, and finishes once', () => {
    const { calls, targets } = fakes()
    const onDone = vi.fn()
    const p = playOpening(steps, targets, { onDone, skipFadeMs: 160 })
    vi.advanceTimersByTime(900)
    p.skip()
    p.skip()
    expect(calls.filter((c) => c.target !== 'root' || c.keyframes.length === 3).every((c) => c.cancelled || c.target === 'root')).toBe(true)
    const fade = calls[calls.length - 1]
    expect(fade.target).toBe('root')
    expect(fade.options.duration).toBe(160)
    expect(onDone).not.toHaveBeenCalled()
    vi.advanceTimersByTime(161)
    expect(onDone).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(OPENING_MS)
    expect(onDone).toHaveBeenCalledTimes(1) // the natural end timer was cleared
  })

  it('cancel (the screen closed) stops everything without finishing', () => {
    const { calls, targets } = fakes()
    const onDone = vi.fn()
    const ran = vi.fn()
    const p = playOpening(steps, targets, { onDone, cues: [{ at: 1200, run: ran }] })
    p.cancel()
    vi.advanceTimersByTime(OPENING_MS * 2)
    expect(onDone).not.toHaveBeenCalled()
    expect(ran).not.toHaveBeenCalled()
    expect(calls.every((c) => c.cancelled)).toBe(true)
  })

  it('does not strand the reader when the browser cannot animate', () => {
    const onDone = vi.fn()
    playOpening(steps, { root: {} as Animatable, letter: {} as Animatable }, { onDone })
    vi.advanceTimersByTime(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('tolerates a missing element', () => {
    const { calls, targets } = fakes()
    delete targets.crease
    const onDone = vi.fn()
    playOpening(steps, targets, { onDone })
    expect(calls.length).toBe(steps.length - 1)
    vi.advanceTimersByTime(OPENING_MS + 1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
