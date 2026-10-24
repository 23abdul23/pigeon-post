import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import BirdViewer from '../components/BirdViewer'
import FlightMap from '../components/FlightMap'
import { Frame } from '../components/Layout'
import { birdBySpecies } from '../lib/birds'
import { serverNow } from '../lib/device'
import { computeProgress, flightIds, flightRole, heartbeat, landIfStillOwner, landSession, markLeft, takeOver } from '../lib/flight'
import { fmtKm, pointAtKm, wrapLng } from '../lib/geo'
import { nearestCity } from '../lib/places'
import { stopsAhead } from '../lib/stops'
import { getState, setState, useStore, type ActiveFlight } from '../lib/store'
import { windAt, windNote, type Wind } from '../lib/weather'
import WelcomeBack from './WelcomeBack'

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function Focus() {
  const { tripId } = useParams()
  const nav = useNavigate()
  const session = useStore((s) => s.session)
  const flight = useStore((s) => s.flight)
  const stories = useStore((s) => s.stories)
  const trip = useStore((s) => s.trip)
  const landing = useStore((s) => s.landing)
  const bird = useStore((s) => s.bird)
  const soundOn = useStore((s) => s.soundOn)
  const volume = useStore((s) => s.settings.volume)
  const [now, setNow] = useState(() => serverNow())
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [near, setNear] = useState('')
  const [ahead, setAhead] = useState('')
  const [wind, setWind] = useState<{ w: Wind; heading: number } | null>(null)
  const [takingOver, setTakingOver] = useState(false)
  // observer: another device flies this trip; the bird moves on the server clock, and only the owner heartbeats or lands
  const observing = flightRole() === 'observer' && flight?.tripId === tripId
  const [watched, setWatched] = useState<ActiveFlight | null>(null)
  if (observing && flight !== watched) setWatched(flight) // remembered so its landing can be shown once it ends elsewhere
  const live = session ?? (observing ? flight : null)
  const liveRef = useRef(live)
  liveRef.current = live

  const flying = !!session && !session.leftAtMs
  const away = !!session?.leftAtMs || landing?.reason === 'left'

  // A stale heartbeat on load means the tab was closed or reloaded: treat that as leaving.
  useEffect(() => {
    const s = getState().session
    if (s && !s.leftAtMs && serverNow() - (s.heartbeatMs ?? s.startMs) > 3000) {
      setState({ session: { ...s, leftAtMs: s.heartbeatMs ?? s.startMs } })
    }
  }, [])

  // Leaving the tab freezes progress; coming back lands the bird (this also lands a session found stale on mount).
  useEffect(() => {
    const onHide = markLeft
    // lands only if no other device took the flight over meanwhile (else this screen turns into the observer view)
    const onShow = () => {
      if (getState().session?.leftAtMs) void landIfStillOwner('left')
    }
    const onVis = () => (document.visibilityState === 'hidden' ? onHide() : onShow())
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    if (getState().session?.leftAtMs && document.visibilityState === 'visible') onShow()
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  // Clock tick + local heartbeat while flying (or watching); the server heartbeat every 30 s, owner only.
  useEffect(() => {
    if (!flying && !observing) return
    const id = window.setInterval(() => {
      setNow(serverNow())
      const s = getState().session
      if (s && !s.leftAtMs) setState({ session: { ...s, heartbeatMs: serverNow() } })
    }, 1000)
    return () => window.clearInterval(id)
  }, [flying, observing])

  useEffect(() => {
    if (!flying) return
    const id = window.setInterval(heartbeat, 30_000)
    return () => window.clearInterval(id)
  }, [flying])

  const progress = useMemo(() => (live && trip ? computeProgress(live, trip, now) : null), [live, trip, now])

  const stops = useMemo(
    () => (live && trip ? stopsAhead(trip.routeKm, live.baseKm, live.durationMin) : []),
    [live?.baseKm, live?.durationMin, trip?.routeKm], // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    if (flying && progress && (progress.done || progress.arrived)) void landSession('completed')
  }, [flying, progress])

  useEffect(() => {
    if (landing && landing.reason !== 'left' && !session) nav(`/landing/${landing.storyId}`, { replace: true })
  }, [landing, session, nav])

  // Place names for the little notes on the map.
  useEffect(() => {
    if ((!flying && !observing) || !trip) return
    let cancelled = false
    const look = async () => {
      const s = liveRef.current
      if (!s) return
      const p = computeProgress(s, trip, serverNow())
      const here = pointAtKm(trip.route, p.km).pt
      const front = pointAtKm(trip.route, Math.min(trip.routeKm, p.km + 250)).pt
      const [a, b, w] = await Promise.all([nearestCity(here[0], here[1]), nearestCity(front[0], front[1]), windAt(here[0], wrapLng(here[1]))])
      if (!cancelled) {
        setNear(a.name)
        setAhead(b.name)
        if (w) setWind({ w, heading: pointAtKm(trip.route, p.km).bearing })
      }
    }
    void look()
    const id = window.setInterval(look, 8000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [flying, observing, trip])

  if (!trip || trip.id !== tripId) return <Navigate to="/home" replace />
  if (!session && !landing && !observing) {
    // a watched flight that ended elsewhere: show its landing once the synced story is here
    const id = watched && flightIds(watched).storyId
    return <Navigate to={id && stories.some((x) => x.id === id) ? `/landing/${id}` : '/home'} replace />
  }

  if (away) return <WelcomeBack />

  const species = birdBySpecies(bird?.species ?? 'pigeon')
  const km = progress?.km ?? 0
  const pct = Math.round((km / trip.routeKm) * 100)
  const heading = Math.round(pointAtKm(trip.route, km).bearing)
  const circ = 2 * Math.PI * 20

  return (
    <Frame>
      <div className="relative h-dvh min-h-[520px] overflow-hidden bg-cream">
        <FlightMap
          route={trip.route}
          stops={stops}
          getKm={() => {
            const s = liveRef.current
            return s ? computeProgress(s, trip, serverNow()).km : km
          }}
          className="absolute inset-0"
        />
        <div className="pointer-events-none absolute inset-0 bg-[rgba(255,248,244,0.18)]" />

        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
          <BirdViewer bird={species} flight className="h-44 w-60" />
        </div>

        <div className="pointer-events-none absolute left-6 top-[42%] flex flex-col gap-1 opacity-80">
          <span className="flex w-fit items-center gap-1 rounded-full bg-card-soft/85 px-2.5 py-1 text-[14px] text-ink-2 shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[2px]">
            <img src="/assets/ic-cloud.svg" alt="" className="h-[8.7px] w-3" />
            Over {near || 'open'} skies
          </span>
          <span className="-rotate-3 pl-2 font-hand text-[22px] font-medium text-[#8e4d31]">{wind ? windNote(wind.w, wind.heading) : 'reading the wind...'}</span>
        </div>
        {ahead && (
          <span className="pointer-events-none absolute bottom-[26%] right-8 rounded-md bg-card/70 px-2 py-0.5 text-[12px] font-semibold tracking-[0.36px] text-muted opacity-70">
            {ahead} ahead
          </span>
        )}

        <aside className="absolute right-4 top-3 w-[270px] max-w-[calc(100%-2rem)] rounded-2xl bg-white/90 p-3.5 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)] backdrop-blur-[6px]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.6px] text-ink-2">
              <span className="size-2 rounded-full bg-sage" />
              Focus flight
            </span>
            {observing ? (
              <button
                type="button"
                disabled={takingOver}
                onClick={() => {
                  setTakingOver(true)
                  void takeOver().finally(() => setTakingOver(false))
                }}
                className="rounded bg-[rgba(239,231,225,0.6)] px-1.5 py-0.5 text-[12px] font-semibold tracking-[0.36px] text-[#8e4d31] disabled:opacity-60"
              >
                Take over
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmEnd(true)} className="rounded bg-[rgba(239,231,225,0.6)] px-1.5 py-0.5 text-[12px] font-semibold tracking-[0.36px] text-[#8e4d31]">
                End flight
              </button>
            )}
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="font-serif text-[38px] font-semibold leading-[38px] tracking-[-0.95px] text-ink" aria-live="off">
                {mmss(progress?.remainingMs ?? 0)}
              </p>
              <p className="flex items-center gap-1 pt-1 text-[12px] font-semibold tracking-[0.36px] text-sky-ink">
                <img src="/assets/ic-nav-small.svg" alt="" className="size-[10.5px]" />
                <span className="max-w-[130px] truncate">
                  {trip.dest.name}, {trip.dest.country}
                </span>
              </p>
            </div>
            <div className="relative flex size-12 items-center justify-center" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Trip progress">
              <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
                <circle cx="24" cy="24" r="20" fill="none" stroke="#e9e1db" strokeWidth="4" />
                <circle cx="24" cy="24" r="20" fill="none" stroke="#446650" strokeWidth="4" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.min(1, pct / 100))} />
              </svg>
              <span className="relative text-[12px] font-bold tracking-[0.36px] text-sage">{pct}%</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-2.5">
            <span className="text-[14px] text-muted">Distance remaining</span>
            <span className="text-[12px] font-bold tracking-[0.36px] text-ink">{fmtKm(Math.max(0, trip.routeKm - km))} left</span>
          </div>
        </aside>

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 px-4 pb-6 pt-2">
          <p className="mx-auto flex items-center gap-1.5 rounded-full bg-card-soft/70 px-4 py-1 text-[16px] text-[rgba(142,77,49,0.9)]">
            <img src="/assets/ic-leaf.svg" alt="" className="size-[10.7px]" />
            {observing ? 'Flying on your other device' : 'Stay on this tab. Your bird is flying.'}
          </p>
          <p className="-rotate-2 text-center font-hand text-[22px] font-medium leading-7 text-sage">
            heading {heading}° {COMPASS[Math.round(heading / 45) % 8]} · steady wings
          </p>
          <div className="flex items-end justify-between">
            <button
              type="button"
              onClick={() => setState({ soundOn: !soundOn })}
              aria-pressed={soundOn}
              className="flex items-center gap-2 rounded-full bg-white/90 py-2 pl-2 pr-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px]"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-[#c6ecd0]">
                <img src="/assets/ic-wave.svg" alt="" className="h-[14.2px] w-[12.75px]" />
              </span>
              <span className="text-left">
                <span className="block text-[12px] font-bold leading-[15px] tracking-[0.36px] text-ink">Meadow &amp; coo</span>
                <span className="block text-[10px] leading-[12.5px] text-muted">{soundOn ? `Volume ${volume}%` : 'Muted'}</span>
              </span>
            </button>
            <div className="flex items-center gap-2 rounded-2xl bg-white/90 px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px]">
              <span className="flex size-6 items-center justify-center rounded-full bg-card">
                <img src="/assets/ic-compass-small.svg" alt="" className="size-[13.3px]" />
              </span>
              <span className="text-right">
                <span className="block text-[12px] font-bold leading-[15px] tracking-[0.36px] text-ink">{wind ? `${Math.round(wind.w.tempC)}°C below` : 'Temp: ...'}</span>
                <span className="block text-[10px] leading-[12.5px] text-muted">{wind ? `Wind ${Math.round(wind.w.speedKmh)} km/h` : 'Wind: ...'}</span>
              </span>
            </div>
          </div>
        </div>

        {confirmEnd && (
          <div role="dialog" aria-modal="true" aria-label="Land here?" className="absolute inset-0 z-20 flex items-center justify-center bg-ink/30 p-6">
            <div className="w-full rounded-2xl bg-white p-5 text-center shadow-[0_8px_24px_rgba(62,58,54,0.2)]">
              <h2 className="font-serif text-[20px] font-semibold text-ink">Land here?</h2>
              <p className="pt-1 text-[14px] text-ink-2">Your bird will rest where it is and you can pick up this trip later.</p>
              <div className="flex gap-2 pt-4">
                <button type="button" onClick={() => setConfirmEnd(false)} className="flex-1 rounded-full bg-card-soft py-2.5 text-[14px] font-bold text-ink-2">
                  Keep flying
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmEnd(false)
                    void landSession('ended')
                  }}
                  className="flex-1 rounded-full bg-[#8e4d31] py-2.5 text-[14px] font-bold text-white"
                >
                  Land here
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Frame>
  )
}
