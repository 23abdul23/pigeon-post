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

const DURATIONS = [10, 15, 25, 30]

function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default function Dashboard() {
  const nav = useNavigate()
  const user = useStore((s) => s.user)
  const home = useStore((s) => s.homeCity)
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
    const t = createTrip(dest)
    startSession(t, minutes)
    nav(`/fly/${t.id}`)
  }

  function continueTrip() {
    if (!active) return
    if (elsewhere) {
      nav(`/fly/${elsewhere.tripId}`)
      return
    }
    if (active.status === 'DELIVERED') {
      const back = startReturn(minutes)
      if (back) nav(`/fly/${back.id}`)
      return
    }
    startSession({ ...active, status: active.status === 'PAUSED' ? 'OUTBOUND' : active.status }, minutes)
    nav(`/fly/${active.id}`)
  }

  const pct = active ? Math.min(100, Math.round((active.progressKm / active.routeKm) * 100)) : 0
  const segs = 8
  const filled = Math.floor((pct / 100) * segs)

  return (
    <AppLayout>
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex items-center justify-between pt-1">
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-[0.6px] text-ink-2">
              <img src="/assets/ic-home-pin.svg" alt="" className="h-3 w-[10.7px]" />
              Home: {home?.name ?? '—'}
            </span>
            <h1 className="font-serif text-[24px] leading-8 tracking-[-0.6px] text-ink">
              {greeting()}, {user?.name ?? 'friend'}
            </h1>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-[#efe7e1] px-3 py-1.5 text-[12px] font-medium tracking-[0.36px] text-ink-2 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <span className="size-2 rounded-full bg-sage" />
            Clear Skies
          </span>
        </div>


        <Card className="flex flex-col gap-4 p-5">
          <div className="flex h-7 items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/assets/ic-timer.svg" alt="" className="h-[17.5px] w-[15px]" />
              <h2 className="font-serif text-[20px] font-semibold leading-7 text-ink">Flight Desk</h2>
            </div>
            <Hand className="rotate-1 text-[#8e4d31]">Ready for departure</Hand>
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
            <PlaceSearch
              kind="any"
              value={dest}
              onChange={(p) => {
                setDest(p)
                setError('')
              }}
            />
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
          <PrimaryButton onClick={start}>
            <img src="/assets/ic-send.svg" alt="" className="size-[15px]" />
            {elsewhere ? 'Watch your flight in progress' : 'Start flight'}
          </PrimaryButton>
          <p className="flex items-center justify-center gap-1.5 text-[14px] text-ink-2">
            <img src="/assets/ic-info.svg" alt="" className="size-[13px]" />
            1 minute of focus = 100 km traveled
          </p>
          <Link to="/trip/new" className="-mt-2 text-center text-[13px] font-bold text-sage">
            Fly to a friend or send a letter
          </Link>
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
    </AppLayout>
  )
}
