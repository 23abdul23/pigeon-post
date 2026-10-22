import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Frame } from '../components/Layout'
import { countryName, haversineKm } from '../lib/geo'
import { playRustle } from '../lib/sound'
import { getState, setState, useStore } from '../lib/store'

const STEPS = [
  { title: 'The Letter Arrives', tag: 'En route', tagCls: 'bg-card text-[#7fa38a]', text: 'The chosen cream envelope with red wax seal lifts and centers with soft golden glow, inbox blurred in background.', img: '/assets/eo-1.jpg' },
  { title: 'Breaking the Seal', tag: 'Crackle', tagCls: 'bg-[#ffdbcd] text-[#8e4d31]', text: 'The wax seal pops open with delicate wax fragments and the envelope flap gently folds open upward.', img: '/assets/eo-2.jpg' },
  { title: 'Sliding Out', tag: 'Rustle', tagCls: 'bg-sky text-sky-ink', text: 'The folded cream parchment letter smoothly slides up out of the pocket envelope, revealing peek of handwriting.', img: '/assets/eo-3.jpg' },
  { title: 'Unfolding the Letter', tag: 'Ready', tagCls: 'bg-[#c6ecd0] text-sage', text: 'The letter unfolds into full page format with ink and postal stamp visible, ready to read.', img: '/assets/eo-4.jpg' },
]

const STEP_MS = 1700

export default function EnvelopeOpening() {
  const { letterId } = useParams()
  const nav = useNavigate()
  const letter = useStore((s) => s.letters.find((l) => l.id === letterId))
  const home = useStore((s) => s.homeCity)
  const [step, setStep] = useState(0)

  useEffect(() => {
    playRustle()
    const id = window.setInterval(() => setStep((s) => Math.min(3, s + 1)), STEP_MS)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (step >= 3) return
    if (step > 0) playRustle()
  }, [step])

  if (!letter) return <Navigate to="/mailbox" replace />

  function finish() {
    setState({ letters: getState().letters.map((l) => (l.id === letterId ? { ...l, status: 'OPENED' as const } : l)) })
    nav(`/mailbox/${letterId}`, { replace: true })
  }

  const km = home ? Math.round(haversineKm(home, getState().friends.find((f) => f.id === letter.fromId) ?? home)) : 0
  const minutes = Math.max(1, Math.round(letter.text.split(/\s+/).length / 200))
  const stamp = `${letter.fromCity.slice(0, 5).toUpperCase()} ${new Date(letter.dateMs).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }).replace('/', '.')}`

  return (
    <Frame>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-cream/85 px-4 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-[12px]">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => nav('/mailbox')} aria-label="Go back" className="flex size-11 items-center justify-center rounded-full">
            <img src="/assets/tc-back.svg" alt="" className="size-4" />
          </button>
          <h1 className="font-serif text-[20px] font-semibold leading-7 tracking-[-0.5px] text-ink">Envelope Opening</h1>
        </div>
        <Link to="/settings/profile" aria-label="Profile" className="flex size-11 items-center justify-center">
          <img src="/assets/profile.jpg" alt="" className="size-8 rounded-full shadow-[0_0_0_2px_rgba(127,163,138,0.4)]" />
        </Link>
      </header>

      <main className="flex-1 px-5 pb-8">
        <div className="flex items-center justify-between py-2">
          <span className="flex items-center gap-1.5 rounded-full bg-[#efe7e1] px-3 py-1.5 text-[12px] font-semibold text-ink-2 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <img src="/assets/eo-sound.svg" alt="" className="h-[13.3px] w-3" />
            Soft paper rustle
          </span>
          <button type="button" onClick={finish} className="rounded-lg px-2 py-1 text-[14px] font-bold tracking-[0.28px] text-[#8e4d31]">
            Skip to letter
          </button>
        </div>

        <div className="pt-2">
          <p className="flex items-center gap-1.5 pb-1 text-[12px] font-semibold uppercase tracking-[0.6px] text-sage">
            <img src="/assets/eo-airmail.svg" alt="" className="h-[13.6px] w-[15.5px]" />
            Airmail dispatch
          </p>
          <h2 className="font-serif text-[24px] leading-8 tracking-[-0.6px] text-ink">Opening Letter from {letter.fromName}</h2>
          <p className="flex items-center gap-2 pt-1 text-[14px] text-ink-2">
            <span className="flex items-center gap-1">
              <img src="/assets/fr-dest.svg" alt="" className="h-[11.7px] w-[9.3px]" />
              {letter.fromCity}, {countryName(letter.cc)}
            </span>
            <span className="text-[12px] text-outline">•</span>
            <span className="flex items-center gap-1">
              <img src="/assets/tc-route-pin.svg" alt="" className="h-[11px] w-[9.3px]" />
              Carried {km.toLocaleString('en-US')} km
            </span>
          </p>
          <p className="-rotate-1 pt-1 font-hand text-[22px] font-medium leading-7 text-[#8e4d31]">"Penned under lantern light at {letter.fromCity}..."</p>
        </div>

        <ol className="relative mt-6 flex flex-col gap-6" aria-label="Opening sequence">
          <span className="absolute bottom-8 left-[23px] top-6 w-0.5 rounded-full bg-line" aria-hidden />
          {STEPS.map((s, i) => {
            const state = i < step ? 'done' : i === step ? 'now' : 'todo'
            return (
              <li key={s.title} className={`relative flex items-start gap-4 transition-opacity duration-500 ${state === 'todo' ? 'opacity-45' : ''}`} aria-current={state === 'now' ? 'step' : undefined}>
                <span
                  className={`relative flex size-12 shrink-0 items-center justify-center rounded-full font-serif text-[20px] font-semibold shadow-[0_1px_1px_rgba(0,0,0,0.05)] transition-colors duration-500 ${
                    i === 3 && state !== 'todo' ? 'bg-sage' : 'bg-line'
                  } ${state === 'now' && i !== 3 ? 'ring-4 ring-[rgba(213,135,103,0.35)]' : ''}`}
                  style={{ color: i === 0 ? '#446650' : i === 1 ? '#8e4d31' : '#476270' }}
                >
                  {i === 3 ? <img src="/assets/eo-envelope.svg" alt="" className="h-[15px] w-[17.5px]" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1 rounded-xl bg-card-soft p-4 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[14px] font-bold tracking-[0.28px] text-ink">{s.title}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold tracking-[0.36px] ${s.tagCls}`}>{s.tag}</span>
                  </div>
                  <p className="pt-1 text-[14px] leading-5 text-ink-2">{s.text}</p>
                  <div className="relative mt-1 h-[148px] overflow-hidden rounded-lg bg-card">
                    <img src={s.img} alt="" className="absolute inset-x-0 bottom-0 top-1 h-[calc(100%-4px)] w-full object-cover" />
                    {i === 0 && (
                      <span className="absolute right-2 top-3 flex items-center gap-1 rounded bg-white/90 px-2 py-1 text-[12px] font-semibold tracking-[0.36px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                        <img src="/assets/eo-stamp.svg" alt="" className="size-[11.7px]" />
                        {stamp}
                      </span>
                    )}
                    {i === 1 && (
                      <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-[rgba(54,15,0,0.8)] px-2 py-1 text-[11px] text-[#ffdbcd] backdrop-blur-[2px]">
                        <img src="/assets/eo-crack.svg" alt="" className="h-[9.5px] w-[9.75px]" />
                        Crystalline wax crack
                      </span>
                    )}
                    {i === 2 && (
                      <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-white/90 px-2 py-1 text-[12px] font-semibold tracking-[0.36px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                        <img src="/assets/eo-ink.svg" alt="" className="h-[10.5px] w-[11px]" />
                        Sepia sumi ink
                      </span>
                    )}
                    {i === 3 && (
                      <span className="absolute inset-x-0 bottom-0 top-1 flex items-end bg-gradient-to-t from-white/80 via-transparent to-transparent p-2.5">
                        <span className="font-hand text-[22px] font-medium leading-7 text-[#8e4d31]">"{letter.text.split(/\s+/).slice(0, 7).join(' ')}..."</span>
                      </span>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>

        <div className="mt-6 flex items-center gap-4 rounded-xl bg-card p-4 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[rgba(213,135,103,0.3)]">
            <img src="/assets/eo-headphones.svg" alt="" className="size-[16.5px]" />
          </span>
          <div>
            <p className="text-[14px] font-bold tracking-[0.28px] text-ink">Haptic &amp; Audio Sensation</p>
            <p className="text-[14px] leading-5 text-ink-2">♪ Gentle paper rustle &amp; seal crackle {getState().soundOn ? 'enabled' : 'muted'}</p>
          </div>
        </div>

        <div className="pt-6">
          <button
            type="button"
            onClick={finish}
            disabled={step < 3}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#d58767] text-[14px] font-bold uppercase tracking-[0.35px] text-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)] transition-opacity disabled:opacity-60"
          >
            Read full letter
            <img src="/assets/eo-arrow.svg" alt="" className="size-[13.3px]" />
          </button>
          <p className="pt-2 text-center text-[14px] text-ink-2">Estimated reading time • {minutes} minute{minutes > 1 ? 's' : ''}</p>
        </div>
      </main>
    </Frame>
  )
}
