import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  CHIPS,
  COLORS,
  ENV_H,
  ENV_W,
  LET_H,
  LET_W,
  SEAL,
  SOUND_CUES_MS,
  openingSteps,
  playOpening,
  readingScale,
  stageScaleFor,
  type Animatable,
  type Target,
} from '../lib/envelopeOpening'
import { countryName } from '../lib/geo'
import { playRustle } from '../lib/sound'

type Props = { fromName: string; fromCity: string; cc: string; dateMs: number; onDone: () => void }

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

const SEAL_X = ENV_W / 2 - SEAL / 2
const SEAL_Y = ENV_H * 0.54 - SEAL / 2
const FLAP_H = ENV_H * 0.54
const wax = 'radial-gradient(circle at 35% 30%, #d9594a, #a63326 62%, #7d2418)'

/**
 * Full-screen "opening the envelope" moment, shown when an unread letter is tapped. Calls `onDone` when it has faded out
 * (or at once when the person prefers reduced motion), then the letter underneath is what they read. Tap, Esc or Enter skips.
 */
export default function EnvelopeOpener({ fromName, fromCity, cc, dateMs, onDone }: Props) {
  const els = useRef<Partial<Record<Target, HTMLElement | null>>>({})
  const set = (t: Target) => (el: HTMLElement | null) => void (els.current[t] = el)
  const skipRef = useRef<() => void>(() => {})
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const reduced = useMemo(reducedMotion, [])
  const view = useMemo(() => {
    const s = stageScaleFor(window.innerWidth)
    return { s, k: readingScale(window.innerWidth, window.innerHeight, s) }
  }, [])

  // before paint, so the first frame is the envelope in its start pose rather than a flash of the finished state
  useLayoutEffect(() => {
    if (reduced) {
      doneRef.current()
      return
    }
    const player = playOpening(openingSteps({ readingScale: view.k }), els.current as Partial<Record<Target, Animatable | null>>, {
      onDone: () => doneRef.current(),
      cues: SOUND_CUES_MS.map((at) => ({ at, run: playRustle })),
    })
    skipRef.current = player.skip
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), player.skip())
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      player.cancel()
    }
  }, [reduced, view.k])

  if (reduced) return null

  const first = fromName.split(' ')[0]
  const day = new Date(dateMs)
  const postmark = `${fromCity.slice(0, 6).toUpperCase()}\n${String(day.getDate()).padStart(2, '0')}.${String(day.getMonth() + 1).padStart(2, '0')}`
  const hidden = { opacity: 0 } as const

  return (
    <div
      ref={set('root')}
      role="dialog"
      aria-modal="true"
      aria-label={`Opening the letter from ${fromName}`}
      onClick={() => skipRef.current()}
      className="fixed inset-0 z-[60] flex touch-manipulation items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_42%,#fff8f4_0%,#f4ece6_55%,#e6d9cd_100%)]"
    >
      <span className="sr-only" role="status">
        Opening your letter from {fromName}. Press Escape to skip.
      </span>
      <button
        type="button"
        onClick={(e) => (e.stopPropagation(), skipRef.current())}
        className="absolute right-3 top-3 z-10 flex h-11 items-center rounded-full px-4 text-[14px] font-bold tracking-[0.28px] text-[#8e4d31]"
      >
        Skip
      </button>

      <div ref={set('glow')} aria-hidden style={hidden} className="pointer-events-none absolute left-1/2 top-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle,rgba(255,214,150,0.55),rgba(255,214,150,0)_65%)]" />

      <div aria-hidden style={{ width: ENV_W, height: ENV_H, transform: `scale(${view.s})` }} className="relative">
        <div ref={set('stage')} style={{ ...hidden, isolation: 'isolate' }} className="absolute inset-0">
          <div ref={set('shadow')} style={hidden} className="absolute -bottom-5 left-6 right-6 h-8 rounded-[50%] bg-black/30 blur-xl" />

          <div ref={set('back')} className="absolute inset-0 rounded-[10px]" style={{ zIndex: 1, background: 'linear-gradient(180deg,#d6bd9a,#e4cfae)', boxShadow: 'inset 0 2px 6px rgba(80,50,20,.25)' }} />

          <div
            ref={set('flap')}
            className="absolute left-0 top-0 w-full rounded-t-[10px]"
            style={{
              zIndex: 6,
              height: FLAP_H,
              transformOrigin: '50% 0',
              clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
              backgroundColor: COLORS.flapOutside,
              backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,.35), rgba(120,80,30,.08))',
            }}
          />

          <div
            ref={set('letter')}
            style={{ ...hidden, zIndex: 3, left: (ENV_W - LET_W) / 2, top: (ENV_H - LET_H) / 2, width: LET_W, height: LET_H }}
            className="absolute overflow-hidden rounded-[4px] bg-[linear-gradient(180deg,#ffffff,#fbf6f0)] shadow-[0_2px_8px_rgba(62,40,20,0.25)]"
          >
            {[0.16, 0.3, 0.44, 0.58, 0.72, 0.86].map((y, i) => (
              <span key={y} className="absolute left-[10%] h-[2px] rounded-full bg-ink/15" style={{ top: `${y * 100}%`, width: `${[72, 80, 64, 78, 70, 40][i]}%` }} />
            ))}
            <span ref={set('crease')} style={hidden} className="absolute inset-x-0 top-1/2 h-px bg-black/25" />
          </div>

          <div ref={set('front')} className="absolute inset-0 overflow-hidden rounded-[10px]" style={{ zIndex: 4 }}>
            <svg viewBox={`0 0 ${ENV_W} ${ENV_H}`} className="absolute inset-0 h-full w-full">
              <defs>
                <linearGradient id="pocket" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#f3e4cd" />
                  <stop offset="1" stopColor="#ead7ba" />
                </linearGradient>
              </defs>
              <path d={`M0 0 L${ENV_W / 2} ${FLAP_H} L${ENV_W} 0 L${ENV_W} ${ENV_H} L0 ${ENV_H} Z`} fill="url(#pocket)" />
              <path d={`M0 ${ENV_H} L${ENV_W / 2} ${FLAP_H} L${ENV_W} ${ENV_H} Z`} fill="rgba(255,255,255,.22)" />
              <path d={`M0 0 L${ENV_W / 2} ${FLAP_H} L0 ${ENV_H} Z M${ENV_W} 0 L${ENV_W / 2} ${FLAP_H} L${ENV_W} ${ENV_H} Z`} fill="rgba(120,80,30,.05)" />
              <path d={`M0 ${ENV_H} L${ENV_W / 2} ${FLAP_H} L${ENV_W} ${ENV_H} M0 0 L${ENV_W / 2} ${FLAP_H} L${ENV_W} 0`} stroke="rgba(110,75,35,.28)" strokeWidth="1.2" fill="none" />
            </svg>
            <span
              className="absolute inset-x-0 bottom-0 h-[7px]"
              style={{ background: 'repeating-linear-gradient(135deg,#c8473a 0 10px,#fff8f4 10px 15px,#3b6aa0 15px 25px,#fff8f4 25px 30px)' }}
            />
            <span className="absolute bottom-[24px] right-[22px] flex size-[58px] -rotate-12 items-center justify-center whitespace-pre rounded-full border-2 border-dashed border-ink/35 text-center text-[8px] font-bold uppercase leading-[1.15] tracking-[0.08em] text-ink/45">
              {postmark}
            </span>
          </div>

          {(['sealL', 'sealR'] as const).map((side) => (
            <span
              key={side}
              ref={set(side)}
              className="absolute rounded-full shadow-[0_2px_3px_rgba(0,0,0,0.35)]"
              style={{ zIndex: 8, left: SEAL_X, top: SEAL_Y, width: SEAL, height: SEAL, background: wax, clipPath: side === 'sealL' ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)' }}
            >
              <span className="absolute inset-[5px] rounded-full border border-white/25" />
            </span>
          ))}
          {CHIPS.map((_, i) => (
            <span
              key={i}
              ref={set(`chip${i}` as Target)}
              style={{ ...hidden, zIndex: 8, left: SEAL_X + SEAL / 2 - 3, top: SEAL_Y + SEAL / 2 - 3 }}
              className="absolute size-1.5 rounded-[1px] bg-[#b13a2c]"
            />
          ))}
        </div>
      </div>

      <div ref={set('caption')} aria-hidden style={{ ...hidden, top: `calc(50% + ${Math.round((ENV_H / 2) * view.s) + 56}px)` }} className="absolute inset-x-0 px-6 text-center">
        <p className="font-hand text-[28px] font-medium leading-7 text-[#8e4d31]">A letter from {first}</p>
        <p className="pt-1 text-[12px] font-semibold uppercase tracking-[0.6px] text-ink-2">
          {fromCity}, {countryName(cc)}
        </p>
      </div>
    </div>
  )
}
