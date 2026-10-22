import { useNavigate } from 'react-router-dom'
import { Frame } from '../components/Layout'
import Header from '../components/Header'
import { getState, setState } from '../lib/store'

export default function SignIn() {
  const nav = useNavigate()

  function signIn() {
    // Mock Google sign-in; the AWS plan swaps this for Cognito.
    const s = getState()
    setState({ user: s.user ?? { name: 'Azeem', email: 'azeem@example.com' } })
    const next = !getState().homeCity ? '/onboarding/city' : !getState().bird ? '/onboarding/bird' : '/home'
    nav(next, { replace: true })
  }

  return (
    <Frame>
      <Header title="Sign In" />
      <main className="flex-1 px-4 pb-4 pt-1">
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

        <div className="flex flex-col items-center gap-2 px-2 pt-8">
          <span className="flex items-center gap-1.5 rounded-full bg-sky/50 px-3 py-1 text-[12px] font-semibold tracking-[0.3px] text-sky-ink">
            <img src="/assets/ic-dispatch.svg" alt="" className="size-3" />
            Pigeon Post Dispatch
          </span>
          <h1 className="pt-0.5 text-center font-serif text-[16px] leading-5 tracking-[-0.4px] text-ink">Fly while you focus</h1>
          <p className="max-w-[320px] text-center text-[16px] leading-[26px] text-ink-2">
            Pick a place, stay on this tab, and your bird travels there.
          </p>
        </div>

        <div className="pt-8">
          <button
            type="button"
            onClick={signIn}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-full bg-white px-6 shadow-[0_1px_1px_rgba(0,0,0,0.05)]"
          >
            <img src="/assets/google.svg" alt="" className="size-5" />
            <span className="text-[14px] font-bold tracking-[-0.35px] text-ink">Continue with Google</span>
          </button>
          <p className="mt-3 text-center text-[12px] text-muted">We only ever share your city, never your exact location.</p>
        </div>

        <div className="mt-6 flex items-center gap-3 rounded-xl bg-card p-3.5 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
          <div className="flex size-10 items-center justify-center rounded-lg bg-line">
            <img src="/assets/ic-globe.svg" alt="" className="size-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-serif text-[20px] font-semibold leading-[25px] text-ink">Quiet Collective Flight</span>
              <span className="size-1.5 rounded-full bg-sage" />
            </div>
            <p className="text-[14px] leading-5 text-ink-2">4,128 pigeons airborne over 84 cities today</p>
          </div>
        </div>

        <footer className="pt-8 text-center">
          <div className="flex items-center justify-center gap-2 text-[14px] text-ink-2">
            <a href="#terms" className="underline decoration-outline">Terms of Service</a>
            <span className="text-outline">•</span>
            <a href="#privacy" className="underline decoration-outline">Privacy Policy</a>
            <span className="text-outline">•</span>
            <a href="#sanctuary" className="underline decoration-outline">Bird Sanctuary</a>
          </div>
          <p className="pt-2 text-[12px] font-semibold tracking-[0.36px] text-muted">Designed with slow intentions for deep work</p>
        </footer>
      </main>
    </Frame>
  )
}
