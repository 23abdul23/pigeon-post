import { Link, useNavigate } from 'react-router-dom'
import Flag from '../components/Flag'
import { Frame } from '../components/Layout'
import MiniMap from '../components/MiniMap'
import { startSession } from '../lib/flight'
import { fmtKm } from '../lib/geo'
import { getState, setState, useStore } from '../lib/store'

const dms = (v: number, pos: string, neg: string) => {
  const a = Math.abs(v)
  const d = Math.floor(a)
  const m = Math.round((a - d) * 60)
  return `${d}°${String(m).padStart(2, '0')}′${v >= 0 ? pos : neg}`
}

export default function WelcomeBack() {
  const nav = useNavigate()
  const landing = useStore((s) => s.landing)
  const session = useStore((s) => s.session)
  const trip = useStore((s) => s.trip)
  const bird = useStore((s) => s.bird)
  const stories = useStore((s) => s.stories)
  const story = landing ? stories.find((x) => x.id === landing.storyId) : undefined
  const name = bird?.name ?? 'Your bird'
  const leftAt = session?.leftAtMs ?? landing?.atMs ?? Date.now()
  const time = new Date(leftAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const loading = !story || !landing

  function pause() {
    const t = getState().trip
    setState({ landing: null, trip: t && t.status === 'OUTBOUND' ? { ...t, status: 'PAUSED' } : t })
  }

  function resume() {
    if (!trip) return
    const t = { ...trip, status: 'OUTBOUND' as const }
    setState({ trip: t })
    startSession(t, landing?.durationMin ?? 25)
    nav(`/fly/${t.id}`, { replace: true })
  }

  function startNew() {
    pause()
    nav('/trip/new')
  }

  function close() {
    pause()
    nav('/home', { replace: true })
  }

  const remaining = trip ? Math.max(0, trip.routeKm - (landing?.km ?? trip.progressKm)) : 0

  return (
    <Frame>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-cream/80 px-4 shadow-[0_1px_8px_rgba(62,58,54,0.04)] backdrop-blur-[12px]">
        <button type="button" onClick={close} aria-label="Close notes sheet" className="flex size-11 items-center justify-center rounded-full">
          <img src="/assets/ic-close.svg" alt="" className="size-3.5" />
        </button>
        <h1 className="font-serif text-[20px] font-semibold leading-7 tracking-[-0.5px] text-ink">Session Notes Sheet</h1>
        <Link to="/settings/profile" aria-label="Profile" className="flex size-8 items-center justify-center rounded-full bg-sage">
          <img src="/assets/ic-person.svg" alt="" className="size-3" />
        </Link>
      </header>

      <main className="flex-1 bg-cream pb-5">
        <div className="relative h-72 overflow-hidden">
          <MiniMap center={story ? { lat: story.lat, lng: story.lng } : { lat: 20, lng: 0 }} zoom={story ? 6 : 1.5} className="absolute inset-0 blur-[1px]">
            <div className="absolute inset-0 bg-[rgba(255,248,244,0.35)]" />
            <img src="/assets/wb-map-overlay.svg" alt="" className="pointer-events-none absolute inset-0 size-full" />
          </MiniMap>
          <span className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-[12px] font-semibold tracking-[0.36px] text-ink-2 shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px]">
            <span className="size-2 rounded-full bg-[#7fa38a]" />
            Roosting {story ? `near ${story.place}` : '…'}
          </span>
          <span className="absolute left-1/2 top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#8e4d31] bg-white/80">
            <span className="size-2 rounded-full bg-[#8e4d31]" />
          </span>
        </div>

        <section className="relative -mt-10 rounded-t-[28px] bg-card px-4 pb-6 shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_8px_10px_-6px_rgba(0,0,0,0.1)]">
          <div className="flex justify-center py-1 pt-3">
            <span className="h-1.5 w-10 rounded-full bg-outline/60" />
          </div>
          <div className="flex items-end justify-between pt-4">
            <div>
              <h2 className="flex items-center gap-1.5 font-serif text-[24px] leading-8 tracking-[-0.6px] text-ink">
                <img src="/assets/ic-tag.svg" alt="" className="h-[15px] w-[13.3px]" />
                Welcome back
              </h2>
              <p className="pt-0.5 text-[14px] leading-5 text-ink-2">
                You left at {time}. {name} rested safely near {story?.place ?? '…'}.
              </p>
            </div>
            <span className="mb-3 flex size-[34px] rotate-3 items-center justify-center rounded-full bg-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <img src="/assets/ic-halfmoon.svg" alt="" className="size-[16.7px]" />
            </span>
          </div>

          <div className="flex items-center pt-2">
            <span className="-rotate-1 font-hand text-[22px] font-medium leading-7 text-[#8e4d31]">no rush, tea is still warm...</span>
            <span className="ml-2 h-px flex-1 bg-outline/40" />
          </div>

          <div className="mt-4 flex items-center justify-between rounded-xl bg-card-soft p-2 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <div className="flex min-w-0 items-center">
              <span className="relative z-[2] flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-line">
                <img src="/assets/map-thumb.jpg" alt="" className="absolute inset-0 size-full object-cover opacity-70" />
                <img src="/assets/ic-pin-sheet.svg" alt="" className="relative h-[18.3px] w-[14.7px]" />
              </span>
              <span className="min-w-0 pl-3">
                <span className="flex items-center gap-1 text-[12px] font-bold uppercase tracking-[0.3px] text-sage">
                  Safe haven
                  <span className="text-[10px] font-normal text-muted">•</span>
                  <span className="truncate text-[14px] font-normal normal-case tracking-normal text-ink-2">
                    {story ? `${story.region ?? story.place}, ${story.country}` : '…'}
                  </span>
                </span>
                <span className="block text-[14px] font-semibold leading-5 text-ink">
                  {story ? `${dms(story.lat, 'N', 'S')} ${dms(story.lng, 'E', 'W')}` : '—'}
                </span>
              </span>
            </div>
            <span className="ml-2 flex shrink-0 items-center rounded-full bg-[#c6ecd0] px-2.5 py-1 text-[12px] font-semibold tracking-[0.36px] text-[#002110]">
              <img src="/assets/ic-bed.svg" alt="" className="h-[8.75px] w-[12.8px]" />
              <span className="pl-1">Napping</span>
            </span>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            {loading ? (
              <p className="py-6 text-center text-[14px] text-ink-2" role="status">
                Finding where {name} landed…
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between pb-2.5">
                  {landing.newStampCc ? (
                    <span className="flex items-center rounded-full bg-[#ffdbcd] px-2.5 py-0.5 text-[12px] font-semibold tracking-[0.36px] text-[#360f00]">
                      <img src="/assets/ic-star.svg" alt="" className="size-[11.7px]" />
                      <span className="pl-1.5">New stamp discovered!</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
                      <Flag cc={story.cc} className="w-4" /> {story.country}
                    </span>
                  )}
                  <span className="text-[12px] font-semibold tracking-[0.36px] text-ink-2/70">Field Journal #{stories.length}</span>
                </div>
                <Link to={`/landing/${story.id}`} className="flex items-center">
                  <span className="relative z-[2] size-16 shrink-0 overflow-hidden rounded-lg bg-line shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]">
                    {story.photo && <img src={story.photo} alt="" className="size-full object-cover" />}
                    <span className="absolute inset-0 bg-gradient-to-t from-[rgba(30,27,24,0.4)] to-transparent" />
                    <img src="/assets/ic-stamp-mini.svg" alt="" className="absolute bottom-1 right-1 size-[11.7px]" />
                  </span>
                  <span className="min-w-0 pl-3">
                    <span className="block truncate font-serif text-[20px] font-semibold leading-[22px] text-ink">{story.place}</span>
                    <span className="line-clamp-3 pt-0.5 text-[14px] italic leading-5 text-ink-2">“{story.text}”</span>
                  </span>
                </Link>
              </>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            <Stat icon="/assets/ic-hourglass.svg" iw="h-[13.3px] w-[10.7px]" value={`${Math.max(1, Math.round((landing?.focusedMs ?? 0) / 60000))} min`} label="focused" />
            <Stat icon="/assets/ic-nav-stat.svg" iw="h-[12.7px] w-[10.7px]" value={fmtKm(landing?.gainedKm ?? 0)} label="flown" />
            <Stat icon="/assets/ic-flag-stat.svg" iw="h-[11.3px] w-2.5" value={fmtKm(remaining)} label="next leg" />
          </div>

          <div className="pt-8">
            <button type="button" onClick={resume} disabled={loading || remaining <= 0} className="flex w-full items-center justify-center rounded-full bg-[#8e4d31] px-6 py-3.5 text-[14px] font-bold tracking-[0.35px] text-white shadow-[0_1px_1px_rgba(0,0,0,0.05)] disabled:opacity-50">
              Resume flight
              <img src="/assets/ic-wind-white.svg" alt="" className="ml-2 h-[14.2px] w-[16.7px]" />
            </button>
            <button type="button" onClick={startNew} className="mt-2.5 flex w-full items-center justify-center rounded-full bg-[#efe7e1] px-6 py-3 text-[14px] font-bold tracking-[0.28px] text-ink shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <img src="/assets/ic-plus-circle.svg" alt="" className="size-[15px]" />
              <span className="pl-2">Start a new one</span>
            </button>
          </div>
          <p className="pt-[18px] text-center text-[12px] font-semibold tracking-[0.36px] text-[rgba(66,72,67,0.8)]">{name} carries your thoughts safely at its own pace.</p>
        </section>
      </main>
    </Frame>
  )
}

function Stat({ icon, iw, value, label }: { icon: string; iw: string; value: string; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-xl bg-card-soft p-2.5 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
      <img src={icon} alt="" className={`mb-0.5 ${iw}`} />
      <span className="text-[14px] font-bold leading-5 tracking-[0.28px] text-ink">{value}</span>
      <span className="text-[12px] font-semibold tracking-[0.36px] text-ink-2">{label}</span>
    </div>
  )
}
