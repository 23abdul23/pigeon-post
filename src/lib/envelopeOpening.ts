// The envelope-opening animation as DATA plus a tiny player, so the choreography can be tested without a browser.
//
// Motion rules followed (HyperFrames animation craft): every spatial move is a transform (translate / rotate / scale),
// everything else is opacity; geometry is computed once up front, never measured while playing; nothing is random, so the
// same letter always opens the same way; each element has ONE timeline (no overlapping tweens fighting over a property).
//
// Beats (ms):   0 envelope drops in   700 seal pulses   1000 seal cracks   1250 flap swings open   1650 flap passes 90°
//               1700 letter slides out   2400 letter lifts clear, envelope falls away, sheet unfolds   3100 fade to the real letter

export const ENV_W = 300
export const ENV_H = 200
export const LET_W = 268
export const LET_H = 150 // folded
export const UNFOLD = 2.2 // the sheet grows to this many times its folded height
export const RISE = 176 // how far the letter climbs before it is clear of the pocket
export const SEAL = 34

export type Target =
  | 'root' | 'glow' | 'stage' | 'shadow' | 'back' | 'flap' | 'front' | 'sealL' | 'sealR' | 'letter' | 'crease' | 'caption'
  | 'chip0' | 'chip1' | 'chip2' | 'chip3' | 'chip4' | 'chip5'

export type Step = { target: Target; at: number; ms: number; easing: 'linear'; keyframes: Keyframe[] }

/** Deterministic wax fragments: where each one ends up (px from the seal) and how far it turns. */
export const CHIPS = [
  { dx: -34, dy: -18, rot: -140 },
  { dx: 30, dy: -26, rot: 120 },
  { dx: -22, dy: 28, rot: 200 },
  { dx: 36, dy: 20, rot: -160 },
  { dx: -44, dy: 6, rot: 90 },
  { dx: 12, dy: -40, rot: -80 },
] as const

export const COLORS = { flapOutside: '#ecd9bd', flapInside: '#d6bd9a' } as const

const EASE = {
  out: 'cubic-bezier(.2,.8,.2,1)',
  soft: 'cubic-bezier(.3,.7,.2,1)',
  inOut: 'cubic-bezier(.65,0,.35,1)',
  in: 'cubic-bezier(.45,0,.9,.6)', // first half of the flap swing
  outHalf: 'cubic-bezier(.1,.4,.55,1)', // second half: continues at the speed the first half ended on
  linear: 'linear',
} as const

type Point = readonly [timeMs: number, props: Record<string, string | number>, easingToNext?: string]

/** One element's whole animation from absolute times; the easing on a point shapes the segment that starts there. */
function timeline(target: Target, points: readonly Point[]): Step {
  const start = points[0][0]
  const span = points[points.length - 1][0] - start
  return {
    target,
    at: start,
    ms: span,
    easing: 'linear',
    keyframes: points.map(([t, props, easing]) => ({ offset: span === 0 ? 0 : (t - start) / span, ...props, ...(easing ? { easing } : {}) })),
  }
}

const move = (x: number, y: number, rot = 0, sx = 1, sy = sx) => `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${sx}, ${sy})`
const hinge = (deg: number, dy = 0) => `translateY(${dy}px) perspective(900px) rotateX(${deg}deg)`
const lift = (ty: number, sx: number, sy: number) => `translateY(${ty}px) scale(${sx}, ${sy})`

const T = { seal: 700, crack: 1000, flapStart: 1250, flapMid: 1650, letterStart: 1700, clear: 2400, settle: 3050, fadeStart: 3100, end: 3380 } as const

/** The envelope parts fall away together once the letter is clear. */
const exit = (base: Record<string, string | number>, fallen: string): Point[] => [
  [T.clear, { ...base, opacity: 1 }, EASE.inOut],
  [T.settle - 100, { transform: fallen, opacity: 0 }],
]

export function openingSteps(o: { readingScale: number }): Step[] {
  const k = o.readingScale
  const steps: Step[] = [
    timeline('root', [
      [0, { opacity: 1 }],
      [T.fadeStart, { opacity: 1 }, EASE.inOut],
      [T.end, { opacity: 0 }],
    ]),
    timeline('glow', [
      [0, { opacity: 0 }, EASE.out],
      [900, { opacity: 0.7 }],
      [T.letterStart - 50, { opacity: 0.7 }, EASE.soft],
      [2300, { opacity: 1 }],
      [3000, { opacity: 1 }, EASE.inOut],
      [3300, { opacity: 0 }],
    ]),
    timeline('stage', [
      [0, { transform: move(0, -150, -6, 0.9), opacity: 0 }, EASE.out],
      [650, { transform: move(0, 0, -1.5), opacity: 1 }, EASE.soft],
      [950, { transform: move(0, 0, 0), opacity: 1 }],
    ]),
    timeline('shadow', [
      [0, { opacity: 0, transform: 'scaleX(.6)' }, EASE.out],
      [650, { opacity: 0.35, transform: 'scaleX(1)' }],
      [T.clear, { opacity: 0.35, transform: 'scaleX(1)' }, EASE.inOut],
      [T.settle - 100, { opacity: 0, transform: 'scaleX(.8)' }],
    ]),
    timeline('back', [[0, { transform: move(0, 0), opacity: 1 }], ...exit({ transform: move(0, 0) }, move(0, 70, 0, 0.94))]),
    timeline('front', [[0, { transform: move(0, 0), opacity: 1 }], ...exit({ transform: move(0, 0) }, move(0, 70, 0, 0.94))]),
    // The flap: outside colour above the pocket until it is edge-on, then inside colour behind the letter. Both snaps happen
    // inside one millisecond at the 90° point, where the flap cannot be seen.
    timeline('flap', [
      [0, { transform: hinge(0), backgroundColor: COLORS.flapOutside, zIndex: 6, opacity: 1 }],
      [T.flapStart, { transform: hinge(0), backgroundColor: COLORS.flapOutside, zIndex: 6, opacity: 1 }, EASE.in],
      [T.flapMid, { transform: hinge(-90), backgroundColor: COLORS.flapOutside, zIndex: 6, opacity: 1 }],
      [T.flapMid + 1, { transform: hinge(-90), backgroundColor: COLORS.flapInside, zIndex: 2, opacity: 1 }, EASE.outHalf],
      [2050, { transform: hinge(-180), backgroundColor: COLORS.flapInside, zIndex: 2, opacity: 1 }],
      [T.clear, { transform: hinge(-180), backgroundColor: COLORS.flapInside, zIndex: 2, opacity: 1 }, EASE.inOut],
      [T.settle - 100, { transform: hinge(-180, 70), backgroundColor: COLORS.flapInside, zIndex: 2, opacity: 0 }],
    ]),
    ...(['sealL', 'sealR'] as const).map((side) => {
      const sgn = side === 'sealL' ? -1 : 1
      return timeline(side, [
        [0, { transform: move(0, 0), opacity: 1 }],
        [T.seal, { transform: move(0, 0), opacity: 1 }, EASE.inOut],
        [T.seal + 150, { transform: move(0, 0, 0, 1.08), opacity: 1 }, EASE.soft],
        [T.crack, { transform: move(0, 0), opacity: 1 }, EASE.out],
        [1450, { transform: move(sgn * 20, 12, sgn * 24), opacity: 0 }],
      ])
    }),
    ...CHIPS.map((c, i) =>
      timeline(`chip${i}` as Target, [
        [0, { opacity: 0, transform: move(0, 0) }],
        [T.crack - 1, { opacity: 0, transform: move(0, 0) }],
        [T.crack, { opacity: 1, transform: move(0, 0) }, EASE.out],
        [1450, { opacity: 0, transform: move(c.dx, c.dy + 14, c.rot, 0.5) }],
      ]),
    ),
    // The letter: hidden until the flap is past 90°, slides up behind the pocket, then comes forward and unfolds.
    timeline('letter', [
      [0, { opacity: 0, transform: lift(0, 1, 1), zIndex: 3 }],
      [T.flapMid - 10, { opacity: 0, transform: lift(0, 1, 1), zIndex: 3 }],
      [T.flapMid, { opacity: 1, transform: lift(0, 1, 1), zIndex: 3 }],
      [T.letterStart, { opacity: 1, transform: lift(0, 1, 1), zIndex: 3 }, EASE.inOut],
      [T.clear - 1, { opacity: 1, transform: lift(-RISE, 1, 1), zIndex: 3 }],
      [T.clear, { opacity: 1, transform: lift(-RISE, 1, 1), zIndex: 7 }, EASE.out],
      [T.settle, { opacity: 1, transform: lift(-20, k, k * UNFOLD), zIndex: 7 }],
    ]),
    timeline('crease', [
      [0, { opacity: 0 }],
      [T.clear - 1, { opacity: 0 }],
      [T.clear, { opacity: 0.5 }, EASE.inOut],
      [T.settle - 100, { opacity: 0 }],
    ]),
    timeline('caption', [
      [0, { opacity: 0, transform: move(0, 10) }],
      [450, { opacity: 0, transform: move(0, 10) }, EASE.out],
      [950, { opacity: 1, transform: move(0, 0) }],
      [2200, { opacity: 1, transform: move(0, 0) }, EASE.inOut],
      [2600, { opacity: 0, transform: move(0, 0) }],
    ]),
  ]
  return steps
}

export const OPENING_MS = Math.max(...openingSteps({ readingScale: 1 }).map((s) => s.at + s.ms))

/** Paper rustles: as the flap lifts and as the letter slides out. */
export const SOUND_CUES_MS = [T.flapStart, T.letterStart] as const

/** Scale at which the unfolded sheet fills most of the screen but never overflows it. */
export function readingScale(viewW: number, viewH: number, stageScale: number): number {
  const byWidth = (viewW * 0.9) / (LET_W * stageScale)
  const byHeight = (viewH * 0.72) / (LET_H * UNFOLD * stageScale)
  return Math.max(0.8, Math.min(byWidth, byHeight, 1.6))
}

/** The 300 x 200 design box is scaled to the screen; this is that scale. */
export function stageScaleFor(viewW: number): number {
  return Math.max(0.75, Math.min(1.25, (viewW * 0.84) / ENV_W))
}

type Playing = { cancel(): void; finish?(): void }
export type Animatable = { animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): Playing }

/**
 * Starts every step on its element. `onDone` runs exactly once: after the last beat, or after a short fade when skipped.
 * Without the Web Animations API (very old browsers) it finishes at once instead of leaving the person stuck.
 */
export function playOpening(
  steps: readonly Step[],
  targets: Partial<Record<Target, Animatable | null>>,
  hooks: { onDone(): void; cues?: readonly { at: number; run(): void }[]; skipFadeMs?: number },
): { skip(): void; cancel(): void } {
  const running: Playing[] = []
  const timers: ReturnType<typeof setTimeout>[] = []
  let over = false
  const stopTimers = () => timers.splice(0).forEach(clearTimeout)
  const done = () => {
    if (over) return
    over = true
    stopTimers()
    hooks.onDone()
  }

  const supported = Object.values(targets).every((t) => !t || typeof t.animate === 'function')
  if (!supported) {
    timers.push(setTimeout(done, 0))
  } else {
    for (const s of steps) {
      const el = targets[s.target]
      if (el) running.push(el.animate(s.keyframes, { delay: s.at, duration: s.ms, easing: s.easing, fill: 'both' }))
    }
    for (const c of hooks.cues ?? []) timers.push(setTimeout(c.run, c.at))
    timers.push(setTimeout(done, Math.max(...steps.map((s) => s.at + s.ms))))
  }

  return {
    skip() {
      if (over) return
      stopTimers()
      running.splice(0).forEach((a) => a.cancel())
      const fade = hooks.skipFadeMs ?? 160
      targets.root?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fade, easing: 'linear', fill: 'both' })
      timers.push(setTimeout(done, fade))
    },
    cancel() {
      over = true
      stopTimers()
      running.splice(0).forEach((a) => a.cancel())
    },
  }
}
