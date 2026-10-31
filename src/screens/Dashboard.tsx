import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PlaceSearch from '../components/PlaceSearch'
import { AppLayout } from '../components/Layout'
import { Card, Hand, Pill, PrimaryButton, SoftButton } from '../components/ui'
import Flag from '../components/Flag'
import { deviceId } from '../lib/device'
import { fmtKm, haversineKm } from '../lib/geo'
import { useStore, type Place } from '../lib/store'
import { flightRole, startReturn, startSession } from '../lib/flight'
import { createTrip, tripProblem } from '../lib/trips'
import { greeting } from '../lib/greeting'
import { markIdleAsked, requestIdlePermission, shouldAskIdlePermission } from '../lib/idle'
import BirdThumb from '../components/BirdThumb'
import { birdBySpecies } from '../lib/birds'
import { RANGES, useFlightStats, type FlightRange } from '../components/FlightLog'
import ScreenLockPrompt from '../components/ScreenLockPrompt'

const DURATIONS = [10, 15, 25, 30]

/** The greeting for this device's clock, re-checked every minute and when the tab becomes visible again so it never goes stale. */
function useGreeting(): string {
  const [text, setText] = useState(() => greeting())
  useEffect(() => {
    const refresh = () => setText(greeting())
    const id = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return text
}

export default function Dashboard() {
  const nav = useNavigate()
  const hello = useGreeting()
  const user = useStore((s) => s.user)
  const home = useStore((s) => s.homeCity)
  const bird = useStore((s) => s.bird)
  const trip = useStore((s) => s.trip)
  const stories = useStore((s) => s.stories)
  const flight = useStore((s) => s.flight)
  useStore((s) => s.session) // re-render when this device starts or loses a flight
  const foreign = !!flight && flight.deviceId !== deviceId()
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!foreign) return
    const id = window.setInterval(() => setTick((n) => n + 1), 15_000) // a foreign flight going stale frees "Start flight"
    return () => window.clearInterval(id)
  }, [foreign])
  const elsewhere = flight && flightRole() === 'observer' ? flight : null // flying on another device
  const [minutes, setMinutes] = useState(15)
  const [dest, setDest] = useState<Place | null>(null)
  const [error, setError] = useState('')

  const latest = stories[0]
  const active = trip && trip.status !== 'DONE' ? trip : null
  const km = home && dest ? Math.round(haversineKm(home, dest)) : 0

  function start() {
    if (elsewhere) {
      nav(`/fly/${elsewhere.tripId}`)
      return
    }
    if (!dest) {
      setError('Pick a place to fly to first.')
      return
    }
    const problem = tripProblem(dest)
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    afterLockPrompt(() => {
      const t = createTrip(dest)
      startSession(t, minutes)
      nav(`/fly/${t.id}`)
    })
  }

  function continueTrip() {
    if (!active) return
    if (elsewhere) {
      nav(`/fly/${elsewhere.tripId}`)
      return
    }
    if (active.status === 'DELIVERED') {
      afterLockPrompt(() => {
        const back = startReturn(minutes)
        if (back) nav(`/fly/${back.id}`)
      })
      return
    }
    afterLockPrompt(() => {
      startSession({ ...active, status: active.status === 'PAUSED' ? 'OUTBOUND' : active.status }, minutes)
      nav(`/fly/${active.id}`)
    })
  }

  // Before the first flight on Chrome: explain, then show Chrome's own one-time prompt so a locked screen can be told from leaving the app.
  const [askLock, setAskLock] = useState<(() => void) | null>(null)
  function afterLockPrompt(go: () => void) {
    void shouldAskIdlePermission().then((ask) => (ask ? setAskLock(() => go) : go()))
  }
  function answerLockPrompt(allow: boolean) {
    const go = askLock
    setAskLock(null)
    markIdleAsked()
    // requestPermission must start inside this click; the flight starts whatever the answer is
    if (allow) void requestIdlePermission().finally(() => go?.())
    else go?.()
  }

  const letters = useStore((s) => s.letters)
  const unopened = letters.filter((l) => l.toId === 'me' && l.status === 'DELIVERED')
  const [range, setRange] = useState<FlightRange>('This week')
  const stats = useFlightStats(range)
  const pct = active ? Math.min(100, Math.round((active.progressKm / active.routeKm) * 100)) : 0
  const segs = 8
  const filled = Math.floor((pct / 100) * segs)

  return (
    <AppLayout>
      <div className="flex flex-col gap-4 pb-2 lg:hidden">
        <div className="flex items-center justify-between pt-1">
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-[0.6px] text-ink-2">
              <img src="/assets/ic-home-pin.svg" alt="" className="h-3 w-[10.7px]" />
              Home: {home?.name ?? '—'}
            </span>
            <h1 className="font-serif text-[24px] leading-8 tracking-[-0.6px] text-ink">
              {hello}, {user?.name ?? 'friend'}
            </h1>
          </div>
        </div>


        <Card className="flex flex-col gap-4 p-5">
          <div className="flex h-7 items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/assets/ic-timer.svg" alt="" className="h-[17.5px] w-[15px]" />
              <h2 className="font-serif text-[20px] font-semibold leading-7 text-ink">Flight Desk</h2>
            </div>
          </div>
          <div className="flex flex-col items-center py-2">
            <span className="font-serif text-[38px] font-bold leading-[44px] tracking-[-0.95px] text-ink">{String(minutes).padStart(2, '0')}:00</span>
            <span className="text-[14px] text-ink-2">Minutes of Focused Session</span>
          </div>
          <div className="flex items-center gap-2 px-1" role="radiogroup" aria-label="Session length in minutes">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={minutes === d}
                onClick={() => setMinutes(d)}
                className={`flex-1 rounded-full py-1.5 text-[14px] font-bold tracking-[0.28px] ${
                  minutes === d ? 'bg-[#7fa38a] text-[#183926] shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'bg-card-soft text-ink-2'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 pt-1">
            {/* One row, 65 / 35: where to, and go. `relative` anchors the full-width results list. */}
            <div className="relative flex items-stretch gap-2">
              <div className="min-w-0 basis-[65%]">
                <PlaceSearch
                  kind="any"
                  large
                  listAnchor="parent"
                  value={dest}
                  onChange={(p) => {
                    setDest(p)
                    setError('')
                  }}
                />
              </div>
              <div className="flex basis-[35%]">
                <PrimaryButton
                  onClick={start}
                  aria-label={elsewhere ? 'Watch your flight in progress' : 'Start flight'}
                  className="h-14 px-2 py-0 text-[12px] leading-4"
                >
                  {elsewhere ? 'Watch flight' : 'Start flight'}
                </PrimaryButton>
              </div>
            </div>
            {dest && (
              <div className="flex items-center gap-1.5 overflow-auto py-0.5 pl-1">
                <span className="text-[12px] font-semibold tracking-[0.36px] text-ink-2">Route:</span>
                <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-sky px-2.5 py-0.5 text-[11px] text-[#4d6876] shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                  {dest.name}, {dest.country} <Flag cc={dest.cc} className="w-3.5" />
                  <span className="font-mono opacity-70">({fmtKm(km)})</span>
                </span>
              </div>
            )}
            {error && (
              <p role="alert" className="pl-1 text-[13px] text-[#ba1a1a]">
                {error}
              </p>
            )}
          </div>
          <div role="separator" aria-label="or" className="flex items-center gap-3">
            <span className="h-px flex-1 bg-ink/10" />
            <span className="text-[12px] font-semibold uppercase tracking-[0.6px] text-ink-2">or</span>
            <span className="h-px flex-1 bg-ink/10" />
          </div>
          <SoftButton onClick={() => nav('/trip/new')} className="py-3.5">
            <img src="/assets/fr-envelope.svg" alt="" className="h-[15px] w-[16.7px]" />
            Send mail to a friend
          </SoftButton>
          <p className="flex items-center justify-center gap-1.5 text-[14px] text-ink-2">
            <img src="/assets/ic-info.svg" alt="" className="size-[13px]" />
            1 minute of focus = 100 km traveled
          </p>
        </Card>

        {active ? (
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <h2 className="font-serif text-[20px] font-semibold leading-7 text-ink">{active.dest.name} Journey</h2>
                  <Pill tone={active.status === 'DELIVERED' ? 'sage' : active.status === 'OUTBOUND' ? 'sky' : 'sand'}>
                    {active.status === 'RETURNING' ? 'Returning home' : active.status}
                  </Pill>
                </div>
                <p className="text-[14px] text-ink-2">
                  {pct}% of the way · {fmtKm(Math.max(0, active.routeKm - active.progressKm))} left
                </p>
              </div>
              <span className="flex size-10 items-center justify-center rounded-full bg-[#efe7e1]">
                <img src="/assets/ic-flight.svg" alt="" className="h-[16.6px] w-[19px]" />
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-1.5 py-1" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                {Array.from({ length: segs }, (_, i) => (
                  <span key={i} className={`h-2 flex-1 rounded-full ${i < filled ? 'bg-sage' : 'bg-line'}`} />
                ))}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-ink-2">Leg {active.legs + 1}</span>
                <Hand className="text-sage">{active.status === 'RETURNING' ? 'Winging home' : active.status === 'DELIVERED' ? 'Letter delivered' : 'Over open skies'}</Hand>
              </div>
            </div>
            <SoftButton onClick={continueTrip}>
              <img src="/assets/ic-play.svg" alt="" className="size-[15px]" />
              {elsewhere ? 'Watch flight on your other device' : active.status === 'DELIVERED' ? 'Fly home' : 'Continue trip'}
            </SoftButton>
          </Card>
        ) : (
          <Card className="p-5 text-center">
            <p className="font-serif text-[18px] text-ink">Where shall we go first?</p>
            <p className="pt-1 text-[14px] text-ink-2">Pick a place above and your bird will take off.</p>
          </Card>
        )}

        {/* <Card className="flex items-center gap-3.5 p-4">
          <span className="relative flex size-12 items-center justify-center rounded-2xl bg-[#ffdbcd]">
            <img src="/assets/ic-mail-box.svg" alt="" className="size-[21.7px]" />
            {unopened.length > 0 && (
              <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-[#ba1a1a] text-[9px] font-bold text-white">!</span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-serif text-[16px] leading-5 text-ink">
              {unopened.length === 0 ? 'No letters waiting' : `${unopened.length} letter${unopened.length > 1 ? 's' : ''} waiting`}
            </h3>
            <p className="truncate text-[13px] leading-4 text-ink-2">
              {unopened.length === 0
                ? 'Letters from friends will land here'
                : `From ${[...new Set(unopened.map((l) => l.fromName))].slice(0, 2).join(', ')}${unopened.length > 2 ? `, and ${unopened.length - 2} more` : ''}`}
            </p>
          </div>
          <Link to="/mailbox" className="rounded-full bg-white px-3.5 py-1.5 text-[12px] font-semibold tracking-[0.36px] text-ink shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            Open
          </Link>
        </Card> */}

        {latest && (
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-[0.6px] text-ink-2">
                <img src="/assets/ic-dispatch2.svg" alt="" className="h-[10.7px] w-[13px]" />
                Latest landing dispatch
              </span>
              <span className="text-[11px] text-ink-2">{new Date(latest.dateMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-[#efe7e1] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                {latest.photo && <img src={latest.photo} alt="" className="size-full object-cover" />}
                <span className="absolute bottom-1 right-1 rounded bg-cream/90 px-1 font-mono text-[9px] font-bold text-ink">{latest.cc}</span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h4 className="truncate font-serif text-[16px] leading-5 text-ink">{latest.place}</h4>
                <p className="line-clamp-2 text-[13px] leading-[18px] text-ink-2">"{latest.text}"</p>
                <Link to={`/journal/${latest.id}`} className="flex items-center gap-1 pt-0.5 text-[12px] font-bold text-sage">
                  Read story in Journal
                  <img src="/assets/ic-arrow-right.svg" alt="" className="size-[9.3px]" />
                </Link>
              </div>
            </div>
          </Card>
        )}
      </div>

      <div className="hidden lg:block lg:pb-12">
        <div className="flex items-end justify-between py-4">
          <div className="flex flex-col gap-0.5">
            <div className="flex h-7 items-center gap-2">
              <span className="-rotate-1 font-hand text-[22px] leading-7 text-[#8e4d31]">Morning dispatch • log no. 142</span>
              <span className="size-1.5 rounded-full bg-[#7fa38a]" />
              <span className="text-[12px] font-bold uppercase leading-4 tracking-[0.6px] text-ink-2">Postmaster roost</span>
            </div>
            <h1 className="pt-0.5 font-serif text-[32px] leading-10 tracking-[-0.8px] text-ink">
              {hello}, {user?.name ?? 'friend'}
            </h1>
            <p className="flex items-center gap-1 text-[16px] leading-6 text-ink-2">
              Home roost: {home ? home.name : '—'} {home && <Flag cc={home.cc} className="w-4" />}
            </p>
          </div>
          <span className="flex items-center gap-2 rounded-full bg-card px-4 py-1 text-[14px] font-bold leading-5 tracking-[0.28px] text-ink drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <img src="/assets/ic-check.svg" alt="" className="size-4" />
            {bird?.name ?? 'Your bird'}&apos;s roost
            <span className="rounded-full bg-[#efe7e1] px-1 py-0.5 text-[12px] leading-4 tracking-[0.36px] text-ink-2">{foreign ? 'Away' : 'Active'}</span>
          </span>
        </div>

        <div className="grid grid-cols-12 items-start gap-6 pt-2">
          <div className="col-span-8 flex flex-col gap-6">
            <section className="relative flex min-h-[560px] flex-col justify-between overflow-hidden rounded-[20px] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <img src="/assets/dash-map-watercolor.png" alt="" className="absolute inset-0 size-full object-cover opacity-85" />
              <div className="absolute inset-0 bg-gradient-to-t from-card via-card/0 via-50% to-cream/40" />
              <div className="relative flex items-start justify-between p-4">
                <div className="flex flex-col rounded-xl bg-cream/90 px-4 py-1 shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[4px]">
                  <span className="text-[12px] font-bold uppercase leading-4 tracking-[0.6px] text-ink-2">Cartographic sector</span>
                  <span className="font-serif text-[20px] font-bold leading-7 text-ink">Old World &amp; Eastern Corridors</span>
                </div>
                <div className="flex items-center gap-1 rounded-full bg-cream/90 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[12px]" aria-hidden>
                  <span className="flex size-9 items-center justify-center text-[18px] text-ink-2">+</span>
                  <span className="flex size-9 items-center justify-center text-[18px] text-ink-2">−</span>
                  <span className="h-5 w-px bg-outline/40" />
                  <img src="/assets/ic-compass.svg" alt="" className="mx-2.5 size-[18px]" />
                </div>
              </div>
              <div className="relative flex flex-1 items-center justify-center py-12">
                <div className="flex flex-col items-center gap-2">
                  <span className="flex items-center gap-1.5 rounded-full bg-cream/95 px-4 py-1 font-hand text-[22px] leading-[22px] text-sage shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[4px]">
                    <span className="size-2 rounded-full bg-sage" />
                    {bird?.name ?? 'Your bird'} resting in {home?.name ?? 'home'}
                  </span>
                  <span className="flex size-24 items-center justify-center overflow-hidden rounded-lg shadow-[0_2px_4px_rgba(0,0,0,0.06),0_4px_6px_rgba(0,0,0,0.07)]">
                    {bird && <BirdThumb bird={birdBySpecies(bird.species)} className="size-full object-cover" />}
                  </span>
                  {home && (
                    <span className="rounded-md bg-[#efe7e1]/90 px-2 py-0.5 text-[12px] font-bold leading-4 tracking-[0.36px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                      {Math.abs(home.lat).toFixed(2)}°{home.lat >= 0 ? 'N' : 'S'} {Math.abs(home.lng).toFixed(2)}°{home.lng >= 0 ? 'E' : 'W'}
                    </span>
                  )}
                </div>
              </div>
              <div className="relative flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-4 rounded-full bg-cream/80 px-4 py-1 backdrop-blur-[4px]">
                  {[
                    ['bg-sage', active ? `Outbound (${active.dest.name})` : 'Outbound'],
                    ['bg-sky-ink', 'Planned'],
                    ['bg-[#8e4d31]', 'Historic'],
                  ].map(([c, t]) => (
                    <span key={t} className="flex items-center gap-1 text-[12px] font-bold leading-4 tracking-[0.36px] text-ink-2">
                      <span className={`h-1 w-2.5 rounded-full ${c}`} />
                      {t}
                    </span>
                  ))}
                </div>
                <span className="-rotate-2 font-hand text-[22px] leading-7 text-ink-2">Airmail Route No. 9 ~</span>
              </div>
            </section>

            {latest && (
              <section className="flex items-center gap-4 rounded-[20px] bg-card p-4 drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                <div className="relative h-28 w-44 shrink-0 overflow-hidden rounded-xl bg-[#efe7e1] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                  {latest.photo && <img src={latest.photo} alt="" className="size-full object-cover" />}
                  <span className="absolute left-2 top-2 rounded bg-cream/90 px-1 py-0.5 text-[12px] font-bold leading-4 tracking-[0.36px] text-ink">{latest.cc}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-1 pb-1 text-[12px] font-bold leading-4 tracking-[0.36px] text-ink-2">
                    <span className="uppercase tracking-[0.6px] text-[#8e4d31]">Latest landing dispatch</span>
                    <span>•</span>
                    <span>{new Date(latest.dateMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </div>
                  <h2 className="truncate font-serif text-[20px] font-bold leading-7 text-ink">{latest.place}</h2>
                  <div className="flex items-center justify-between gap-4 pt-2">
                    <span className="line-clamp-2 -rotate-1 font-hand text-[22px] leading-7 text-sage">&quot;{latest.text}&quot;</span>
                    <Link to={`/journal/${latest.id}`} className="flex shrink-0 items-center gap-1 text-[14px] font-bold leading-5 tracking-[0.28px] text-sage">
                      <span>Read story in<br />Journal</span>
                      <img src="/assets/ic-arrow-right.svg" alt="" className="size-[10.7px]" />
                    </Link>
                  </div>
                </div>
              </section>
            )}
          </div>

          <div className="col-span-4 flex flex-col gap-6">
            <section className="flex flex-col rounded-[20px] bg-card p-6 drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <div className="flex h-16 items-end justify-between pb-1">
                <div className="flex flex-col gap-[3px] pt-[5px]">
                  <span className="text-[12px] font-bold uppercase leading-4 tracking-[0.6px] text-ink-2">Session dispatch</span>
                  <h2 className="font-serif text-[24px] leading-8 text-ink">Flight Desk</h2>
                </div>
                <span className="rotate-2 pb-6 font-hand text-[22px] leading-7 text-[#8e4d31]">{elsewhere ? 'In the air ~' : 'Ready for departure ~'}</span>
              </div>
              <div className="py-4">
                <div className="flex flex-col items-center rounded-xl bg-card-soft py-4 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]">
                  <span className="font-serif text-[56px] font-bold leading-[64px] tracking-[-1.4px] text-ink">{String(minutes).padStart(2, '0')}:00</span>
                  <span className="flex items-center gap-1 pt-1 text-[12px] font-bold leading-4 tracking-[0.36px] text-ink-2">
                    <img src="/assets/ic-timer.svg" alt="" className="size-3" />
                    {dest ? `Estimated flight distance: ${fmtKm(km)}` : 'Pick a destination to see the distance'}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1 pb-4">
                <span className="text-[12px] font-bold leading-4 tracking-[0.36px] text-ink-2">Focus Duration (Minutes)</span>
                <div className="flex gap-1" role="radiogroup" aria-label="Session length in minutes">
                  {DURATIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      role="radio"
                      aria-checked={minutes === d}
                      onClick={() => setMinutes(d)}
                      className={`flex-1 rounded-full py-2 text-[14px] font-bold leading-5 tracking-[0.28px] ${
                        minutes === d ? 'bg-[#7fa38a] text-[#183926] drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'bg-cream text-ink'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative flex flex-col gap-1 pb-6">
                <span className="text-[12px] font-bold leading-4 tracking-[0.36px] text-ink-2">Destination Flight Waypoint</span>
                <PlaceSearch
                  kind="any"
                  value={dest}
                  onChange={(p) => {
                    setDest(p)
                    setError('')
                  }}
                />
                {error && (
                  <p role="alert" className="text-[13px] text-[#ba1a1a]">
                    {error}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={start}
                className="flex items-center justify-center gap-2 rounded-full bg-[#d58767] px-6 py-3.5 text-[14px] font-bold leading-5 tracking-[0.35px] text-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]"
              >
                <img src="/assets/ic-play.svg" alt="" className="h-[13px] w-4 brightness-0 invert" />
                {elsewhere ? 'Watch flight' : 'Start Flight'}
              </button>
              <p className="pt-2 text-center text-[14px] leading-5 text-ink-2">
                1 minute of focused work = 100 km traveled{bird ? ` by ${bird.name}` : ''}
              </p>
            </section>

            {active ? (
              <section className="flex flex-col rounded-[20px] bg-card p-6 drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                <div className="flex items-center justify-between pb-1">
                  <div className="flex items-center gap-2">
                    <img src="/assets/ic-flight.svg" alt="" className="h-[17px] w-auto" />
                    <h3 className="font-serif text-[20px] font-bold leading-7 text-ink">{active.dest.name} Journey</h3>
                  </div>
                  <Pill tone={active.status === 'DELIVERED' ? 'sage' : active.status === 'OUTBOUND' ? 'sky' : 'sand'}>
                    {active.status === 'RETURNING' ? 'Returning home' : active.status}
                  </Pill>
                </div>
                <div className="flex items-baseline justify-between pt-1 text-[14px] leading-5 text-ink-2">
                  <span>
                    {pct}% completed • {fmtKm(Math.max(0, active.routeKm - active.progressKm))} left
                  </span>
                  <span className="text-[12px] font-bold tracking-[0.36px] text-ink">Leg {active.legs + 1}</span>
                </div>
                <div className="flex gap-1.5 py-4" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  {Array.from({ length: segs }, (_, i) => (
                    <span key={i} className={`h-2 flex-1 rounded-full ${i < filled ? 'bg-sage' : i === filled && pct > 0 ? 'bg-[#7fa38a]' : 'bg-[#e0d9d3]'}`} />
                  ))}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <Hand className="text-[#8e4d31]">{active.status === 'RETURNING' ? 'Winging home' : active.status === 'DELIVERED' ? 'Letter delivered' : 'Over open skies ~'}</Hand>
                  <button type="button" onClick={continueTrip} className="rounded-full bg-cream px-4 py-1.5 text-[12px] font-bold leading-4 tracking-[0.36px] text-ink drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                    {elsewhere ? 'Watch flight' : active.status === 'DELIVERED' ? 'Fly home' : 'Continue trip'}
                  </button>
                </div>
              </section>
            ) : (
              <section className="rounded-[20px] bg-card p-6 text-center drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                <p className="font-serif text-[18px] text-ink">Where shall we go first?</p>
                <p className="pt-1 text-[14px] text-ink-2">Pick a place above and your bird will take off.</p>
              </section>
            )}

            <section className="flex items-center gap-4 rounded-[20px] bg-card p-4 drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <span className="relative flex size-14 shrink-0 items-center justify-center rounded-2xl bg-cream drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                <img src="/assets/ic-mail-box.svg" alt="" className="size-[26.7px]" />
                {unopened.length > 0 && (
                  <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-[#8e4d31]">
                    <span className="size-1.5 rounded-full bg-cream" />
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-[14px] font-bold leading-5 tracking-[0.28px] text-ink">
                  {unopened.length === 0 ? 'No letters waiting' : `${unopened.length} letter${unopened.length > 1 ? 's' : ''} waiting`}
                  {unopened.length > 0 && <span className="size-2 rounded-full bg-[#8e4d31]" />}
                </p>
                <p className="truncate text-[14px] leading-5 text-ink-2">
                  {unopened.length === 0 ? 'Letters from friends will land here' : `From ${[...new Set(unopened.map((l) => l.fromName))].slice(0, 3).join(', ')}`}
                </p>
              </div>
              <Link to="/mailbox" className="flex items-center gap-1 rounded-full bg-[#efe7e1] px-4 py-2 text-[12px] font-bold leading-4 tracking-[0.36px] text-ink">
                Open
                <img src="/assets/ic-arrow-right.svg" alt="" className="size-[9.3px]" />
              </Link>
            </section>

            <section className="flex flex-col rounded-[20px] bg-card p-6 drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <div className="flex items-center justify-between pb-4">
                <h3 className="font-serif text-[20px] font-bold leading-7 text-ink">Flight Log</h3>
                <div className="flex items-center rounded-full bg-card-soft p-0.5" role="tablist" aria-label="Time range">
                  {RANGES.map((r) => (
                    <button key={r} type="button" role="tab" aria-selected={range === r} onClick={() => setRange(r)} className={`rounded-full px-2 py-1 text-[12px] font-bold leading-4 tracking-[0.36px] ${range === r ? 'bg-cream text-ink' : 'text-ink-2'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['Sites', '/assets/ic-places.svg', String(stats.places), '', 'Dispatched places'],
                    ['Lands', '/assets/ic-countries.svg', String(stats.countries), '', 'Countries landed'],
                    ['Path', '/assets/ic-distance.svg', stats.dist.toLocaleString('en-US'), '', 'Kilometers flown'],
                    ['Focus', '/assets/ic-focus.svg', String(stats.hrs), 'h', 'Time in quiet air'],
                  ] as const
                ).map(([label, icon, value, unit, note]) => (
                  <div key={label} className="flex flex-col rounded-xl bg-cream p-4">
                    <div className="flex items-center justify-between pb-1">
                      <img src={icon} alt="" className="size-4" />
                      <span className="text-[12px] font-bold uppercase leading-4 tracking-[0.36px] text-ink-2">{label}</span>
                    </div>
                    <span className="font-serif text-[24px] leading-8 text-ink">
                      {value}
                      {unit && <span className="pl-1 text-[14px]">{unit}</span>}
                    </span>
                    <span className="text-[14px] leading-5 text-ink-2">{note}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
      {askLock && <ScreenLockPrompt onAllow={() => answerLockPrompt(true)} onSkip={() => answerLockPrompt(false)} />}
    </AppLayout>
  )
}
