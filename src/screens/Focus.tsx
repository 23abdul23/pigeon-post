import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import BirdViewer from '../components/BirdViewer'
import FlightMap from '../components/FlightMap'
import { Frame } from '../components/Layout'
import ResumePrompt from '../components/ResumePrompt'
import StopCard from '../components/StopCard'
import StopsRail from '../components/StopsRail'
import WindStreaks from '../components/WindStreaks'
import { birdBySpecies } from '../lib/birds'
import { serverNow } from '../lib/device'
import { computeProgress, continueRun, flightIds, flightRole, heartbeat, landIfStillOwner, landSession, markLeft, resumeFlight, takeOver } from '../lib/flight'
import { KM_PER_FOCUS_MINUTE, pointAtKm, wrapLng } from '../lib/geo'
import { prefetchStory } from '../lib/stories'
import { stopsAhead } from '../lib/stops'
import { getState, setState, useStore, type ActiveFlight } from '../lib/store'
import { releaseAudio, startAmbience } from '../lib/sound'
import { windAt, type Wind } from '../lib/weather'

/** How long the tab may be hidden before the flight ends instead of offering to continue. */
const AWAY_GRACE_MS = 15_000

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
  const [now, setNow] = useState(() => serverNow())
  const [confirmEnd, setConfirmEnd] = useState(false)
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
  const away = !!session?.leftAtMs

  // A stale heartbeat on load means the tab was closed or reloaded: treat that as leaving.
  useEffect(() => {
    const s = getState().session
    if (s && !s.leftAtMs && serverNow() - (s.heartbeatMs ?? s.startMs) > 3000) {
      setState({ session: { ...s, leftAtMs: s.heartbeatMs ?? s.startMs } })
    }
  }, [])

  // Leaving the tab freezes progress; coming back shows the resume prompt (it reads the store, so showing does nothing).
  useEffect(() => {
    const onHide = markLeft
    const onVis = () => document.visibilityState === 'hidden' && onHide()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  // Leaving only pauses the flight for a short grace period; a longer absence (another app, a locked screen) lands it where the tab was left.
  useEffect(() => {
    const check = () => {
      const left = getState().session?.leftAtMs
      if (document.visibilityState === 'visible' && left && serverNow() - left > AWAY_GRACE_MS) void landIfStillOwner('left')
    }
    check()
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [])

  // Clock tick + local heartbeat while flying (or watching); the server heartbeat every 30 s, owner only.
  useEffect(() => {
    if (!flying && !observing) return
    setNow(serverNow()) // fresh at once, e.g. after resumeFlight moved startMs
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

  // a completed slot short of the destination shows its stop card here; every other landing goes to the landing page
  const midStop = landing?.reason === 'completed' && !session && !!trip && trip.progressKm < trip.routeKm
  const stops = useMemo(
    () => {
      const base = midStop && landing ? landing.km : live?.baseKm // at the landing point behind the stop card
      const slot = midStop && landing ? landing.durationMin : live?.durationMin
      if (!trip || base === undefined || !slot) return []
      // stops stay aligned to where the run began, so reached stops remain on the map and rail across slots
      const step = slot * KM_PER_FOCUS_MINUTE
      return stopsAhead(trip.routeKm, base % step, slot)
    },
    [live?.baseKm, live?.durationMin, trip?.routeKm, midStop, landing?.km, landing?.durationMin], // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    // a session found stale on load has leftAtMs set in the store by now: the resume prompt handles it, not a completion
    if (flying && progress && (progress.done || progress.arrived) && !getState().session?.leftAtMs) void landSession('completed')
  }, [flying, progress])

  useEffect(() => {
    if (landing && !midStop && !session) nav(`/landing/${landing.storyId}`, { replace: true })
  }, [landing, midStop, session, nav])

  // warm the story for the place this slot ends at, so the stop card needs no spinner
  useEffect(() => {
    if (!flying || !session || !trip) return
    const endKm = Math.min(trip.routeKm, session.baseKm + session.durationMin * KM_PER_FOCUS_MINUTE)
    const pt = pointAtKm(trip.route, endKm).pt
    prefetchStory(pt[0], wrapLng(pt[1]), endKm)
  }, [flying, session?.tripId, session?.startMs, session?.durationMin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Breeze and birdsong while flying; stops when muted or the tab is hidden (startAmbience itself checks soundOn and settings.ambience).
  // Hiding also releases the audio device at once, so no player lingers on the lock screen to leave the flight through.
  useEffect(() => {
    if (!flying || !soundOn) return
    let stop: (() => void) | null = null
    const sync = () => {
      stop?.()
      stop = null
      if (document.hidden) releaseAudio()
      else stop = startAmbience()
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('pagehide', releaseAudio)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('pagehide', releaseAudio)
      stop?.()
    }
  }, [flying, soundOn])

  // Wind and temperature at the bird's position.
  useEffect(() => {
    if ((!flying && !observing) || !trip) return
    let cancelled = false
    const look = async () => {
      const s = liveRef.current
      if (!s) return
      const p = computeProgress(s, trip, serverNow())
      const here = pointAtKm(trip.route, p.km).pt
      const w = await windAt(here[0], wrapLng(here[1]))
      if (!cancelled && w) setWind({ w, heading: pointAtKm(trip.route, p.km).bearing })
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

  const species = birdBySpecies(bird?.species ?? 'pigeon')
  const km = midStop && landing ? landing.km : (progress?.km ?? 0)
  const countdown = mmss(midStop && landing ? landing.durationMin * 60000 : (progress?.remainingMs ?? 0))
  const pct = Math.round((km / trip.routeKm) * 100)
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
        <WindStreaks wind={wind} />

        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
          <BirdViewer bird={species} flight className="h-44 w-60" />
        </div>

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
                {countdown}
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
          <StopsRail stops={stops} fromKm={0} routeKm={trip.routeKm} km={km} />
          <p className="pt-2 text-[14px] text-muted">
            Next stop in <span className="font-bold text-ink">{countdown}</span>
          </p>
        </aside>

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 px-4 pb-6 pt-2">
          {observing && <p className="mx-auto rounded-full bg-card-soft/70 px-4 py-1 text-[16px] text-[rgba(142,77,49,0.9)]">Flying on your other device</p>}
          <div className="flex items-end justify-between">
            <button
              type="button"
              onClick={() => setState({ soundOn: !soundOn })}
              aria-pressed={soundOn}
              aria-label="Sound"
              className="flex size-11 items-center justify-center rounded-full bg-white/90 shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px]"
            >
              <span className={`flex size-7 items-center justify-center rounded-full ${soundOn ? 'bg-[#c6ecd0]' : 'bg-card'}`}>
                <img src="/assets/ic-wave.svg" alt="" className={`h-[14.2px] w-[12.75px] ${soundOn ? '' : 'opacity-40'}`} />
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

        {away && <ResumePrompt onContinue={resumeFlight} onLand={() => void landIfStillOwner('left')} />}
        {midStop && landing && (() => {
          const story = stories.find((x) => x.id === landing.storyId)
          return story ? (
            <StopCard
              story={story}
              newStampCc={landing.newStampCc}
              stopsLeft={stopsAhead(trip.routeKm, trip.progressKm, landing.durationMin).length}
              onContinue={() => void continueRun()}
              onFinish={() => {
                setState({ landing: null })
                nav(`/landing/${landing.storyId}`, { replace: true })
              }}
            />
          ) : null
        })()}

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
