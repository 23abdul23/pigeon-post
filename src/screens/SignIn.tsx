import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Frame } from '../components/Layout'
import Header from '../components/Header'
import { COGNITO_CONFIGURED, signIn as cognitoSignIn } from '../lib/auth'
import { getState, setState } from '../lib/store'
import bg1 from '../assets/bird_bg.png'
import bg2 from '../assets/bird_bg_2.png'

const SLIDES = [bg1, bg2]
const SLIDE_MS = 5000

export default function SignIn() {
  const nav = useNavigate()
  const returnTo = (useLocation().state as { returnTo?: string } | null)?.returnTo

  const [slide, setSlide] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setSlide((i) => (i + 1) % SLIDES.length), SLIDE_MS)
    return () => clearInterval(t)
  }, [])

  function signIn() {
    if (COGNITO_CONFIGURED) return void cognitoSignIn(returnTo)
    // Offline dev (no VITE_COGNITO_*): local mock user.
    const s = getState()
    setState({ user: s.user ?? { name: 'Azeem', email: 'azeem@example.com' } })
    const next = !getState().homeCity ? '/onboarding/city' : !getState().bird ? '/onboarding/bird' : '/home'
    nav(next, { replace: true })
  }

  return (
    <Frame>
      <Header title="Sign In" hideLog />
      <main className="lg:max-w-[760px] relative flex flex-1 flex-col overflow-hidden px-4 pb-4 pt-1">
        <div className="absolute inset-0 -z-0" aria-hidden>
          {SLIDES.map((src, i) => (
            <img key={src} src={src} alt="" className={`absolute inset-0 size-full object-cover transition-opacity duration-1000 ${i === slide ? 'opacity-100' : 'opacity-0'}`} />
          ))}
          <div className="absolute inset-0 bg-gradient-to-b from-cream/90 via-cream/55 to-cream/10" />
        </div>
        <div className="relative flex flex-1 flex-col">
        <div className="flex items-center justify-between px-2 pt-2">
          <div className="flex items-center gap-1" aria-hidden>
            <span className="h-2 w-6 rounded-full bg-sage" />
            <span className="size-2 rounded-full bg-line" />
            <span className="size-2 rounded-full bg-line" />
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-card-soft px-2.5 py-1 text-[12px] font-semibold tracking-[0.3px] text-ink-2 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <img src="/assets/ic-nav-arrow.svg" alt="" className="h-3 w-2.5" />
            Step 1 of 3
          </span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-6 pb-12">
        <div className="flex flex-col items-center gap-3 px-2">
          <span className="flex items-center gap-1.5 rounded-full bg-sky/50 px-3 py-1 text-[12px] font-semibold tracking-[0.3px] text-sky-ink">
            <img src="/assets/ic-dispatch.svg" alt="" className="size-3" />
            Fly while you focus
          </span>
          <p className="max-w-[320px] text-center text-[16px] leading-[26px] text-ink-2">
            Pick a place, stay on this tab, and your bird travels there.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={signIn}
            className="inline-flex h-14 items-center justify-center gap-3 rounded-full bg-white px-8 shadow-[0_4px_16px_rgba(62,58,54,0.12)] transition active:scale-[0.98]"
          >
            <img src="/assets/google.svg" alt="" className="size-5" />
            <span className="text-[14px] font-bold tracking-[-0.35px] text-ink">Continue with Google</span>
          </button>
          <p className="text-center text-[12px] text-ink-2">We never share your exact location.</p>
        </div>
        </div>
        </div>
      </main>
    </Frame>
  )
}
