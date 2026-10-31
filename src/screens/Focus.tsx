import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import BirdViewer from '../components/BirdViewer'
import CountryStamps from '../components/CountryStamps'
import FlightHud from '../components/FlightHud'
import FlightPopup from '../components/FlightPopup'
import FlightMap from '../components/FlightMap'
import { Frame } from '../components/Layout'
import ResumePrompt from '../components/ResumePrompt'
import StopCard from '../components/StopCard'
import WindStreaks from '../components/WindStreaks'
import { birdBySpecies } from '../lib/birds'
import { coveredBetween, countryEntries, enteredBetween } from '../lib/countriesAlong'
import { loadCountryAt } from '../lib/countryAt'
import { serverNow } from '../lib/device'
import { computeProgress, flightIds, flightRole, heartbeat, landIfStillOwner, landSession, markLeft, recoverStranded, resumeFlight, settleElapsedSlots, takeOver, unreadCards } from '../lib/flight'
import { startScreenWatch } from '../lib/idle'
import { alertCheckpoint } from '../lib/checkpointAlert'
import { CHECKPOINT_SIZE, POPUP_SIZE, closePopup, getPopup, openPopup, popupSupported, resizePopup, usePopup, watchTabLeave } from '../lib/pip'
import { createPresence, isMobileDevice } from '../lib/presence'
import { holdWakeLock } from '../lib/wakeLock'
import { isKeepAliveActive, setKeepAliveMeta, setKeepAlivePosition, ensureKeepAlive, releaseKeepAlive } from '../lib/keepAlive'
import { KM_PER_FOCUS_MINUTE, pointAtKm, wrapLng } from '../lib/geo'
import { prefetchStory } from '../lib/stories'
import { stopsAhead } from '../lib/stops'
import { getState, setState, useStore, type ActiveFlight } from '../lib/store'
import { releaseAudio, startAmbience, startCoo } from '../lib/sound'
import { windAt, type Wind } from '../lib/weather'

/** How long the tab may be hidden before the flight ends instead of offering to continue. */
const AWAY_GRACE_MS = 15_000

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Lock-screen text and slot progress for the running flight; a waiting stop card takes over the text. */
function keepAliveInfo() {
  const { session: s, trip: t, bird: b, stopCards: all, stories } = getState()
  if (!s || !t || s.leftAtMs) return null
  const stopCards = unreadCards(all, t.id, stories)
  const p = computeProgress(s, t, serverNow())
  const card = stories.find((x) => x.id === stopCards[0]?.storyId)
  const meta = card
    ? { title: `New card: ${card.place}`, artist: `${stopCards.length} stop${stopCards.length === 1 ? '' : 's'} to read` }
    : { title: `${b?.name ?? 'Your bird'} is flying to ${t.dest.name}`, artist: `Next stop in about ${Math.max(1, Math.ceil(p.remainingMs / 60000))} min` }
  return { meta, duration: s.durationMin * 60, elapsed: p.elapsedMs / 1000 }
}

export default function Focus() {
  const { tripId } = useParams()
  const nav = useNavigate()
  const session = useStore((s) => s.session)
  const flight = useStore((s) => s.flight)
  const stories = useStore((s) => s.stories)
  const trip = useStore((s) => s.trip)
  const landing = useStore((s) => s.landing)
  const allCards = useStore((s) => s.stopCards)
  const bird = useStore((s) => s.bird)
  const soundOn = useStore((s) => s.soundOn)
  const win = usePopup() // the floating flight popup, when open
  const [now, setNow] = useState(() => serverNow())
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [wind, setWind] = useState<{ w: Wind; heading: number } | null>(null)
  const [takingOver, setTakingOver] = useState(false)
  // observer: another device flies this trip; the bird moves on the server clock, and only the owner heartbeats or lands
  const observing = flightRole() === 'observer' && flight?.tripId === tripId
  const [watched, setWatched] = useState<ActiveFlight | null>(null)
  if (observing && flight !== watched) setWatched(flight) // remembered so its landing can be shown once it ends elsewhere
  const live = session ?? (observing ? flight : null)
  const turnRef = useRef(0)
  const liveRef = useRef(live)
  liveRef.current = live

  const flying = !!session && !session.leftAtMs
  const away = !!session?.leftAtMs
  const cards = useMemo(() => unreadCards(allCards, tripId ?? '', stories), [allCards, tripId, stories]) // this trip's cards whose story exists
  const headCard = cards[0]
  const headStory = headCard && stories.find((x) => x.id === headCard.storyId)
  const headId = headStory ? headCard?.storyId : undefined

  // A checkpoint in the popup: grow it (Chrome may refuse without a gesture, then it shows the card at its current size) and notify;
  // the notification click is what brings this tab forward. Dismissing the last card shrinks it back to the flying view.
  useEffect(() => {
    if (!win) return
    if (!headId) {
      resizePopup(POPUP_SIZE)
      return
    }
    resizePopup(CHECKPOINT_SIZE)
    if (headStory) alertCheckpoint(headStory.place, () => window.focus())
  }, [win, headId]) // eslint-disable-line react-hooks/exhaustive-deps

  // A stale heartbeat on load means the tab was closed or reloaded: treat that as leaving.
  useEffect(() => {
    const s = getState().session
    if (s && !s.leftAtMs && serverNow() - (s.heartbeatMs ?? s.startMs) > 3000) {
      setState({ session: { ...s, leftAtMs: s.heartbeatMs ?? s.startMs } })
    }
  }, [])

  // Leaving freezes progress (at the moment the person left); coming back shows the resume prompt. A locked screen is NOT leaving,
  // switching tab / app / window is: see lib/presence.ts for the rule and its fallbacks when the lock cannot be read.
  useEffect(() => {
    if (!flying) return
    const watch = startScreenWatch() // Chrome's lock signal, when the permission was given
    const presence = createPresence({
      doc: document,
      win: window,
      mobile: isMobileDevice(),
      screen: watch.screen,
      onScreen: watch.subscribe,
      keepAliveActive: isKeepAliveActive,
      pipActive: () => !!getPopup(), // the popup keeps the flight on screen, so a tab switch is not leaving
      onLeave: (at) => markLeft(at),
      now: serverNow,
    })
    return () => {
      presence.stop()
      watch.stop()
    }
  }, [flying, win])

  // The popup appears when this tab is left and goes when the person returns; it is not shown while they are on this screen.
  useEffect(() => (flying ? watchTabLeave() : undefined), [flying])

  // Landing, End flight and in-app navigation all unmount this screen: the popup goes with it.
  useEffect(() => () => closePopup(), [])

  // Stops the screen from locking by itself while the flight is on screen (a power-button lock is handled above).
  useEffect(() => (flying ? holdWakeLock() : undefined), [flying])

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

  // Quiet audio + Media Session while flying: the lock screen shows the flight and Chrome keeps the tab running.
  useEffect(() => {
    if (!flying) return
    const start = () => {
      const i = keepAliveInfo()
      if (i) void ensureKeepAlive(i.meta).then((ok) => ok && setKeepAlivePosition(i.duration, i.elapsed))
    }
    start() // also while hidden: a chained slot restarts it with the screen off
    const onVis = () => document.visibilityState === 'visible' && start() // retry when autoplay was blocked earlier
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      releaseKeepAlive() // delayed: the handoff to the next chained slot must not cut the audio
    }
  }, [flying])

  // Refresh the notification text and progress on a slot change, a card arriving or reading, and every 30 s.
  useEffect(() => {
    if (!flying) return
    const sync = () => {
      const i = isKeepAliveActive() ? keepAliveInfo() : null
      if (i) {
        setKeepAliveMeta(i.meta)
        setKeepAlivePosition(i.duration, i.elapsed)
      }
    }
    sync()
    const id = window.setInterval(sync, 30_000)
    return () => window.clearInterval(id)
  }, [flying, session?.startMs, cards.length])

  const [countryAt, setCountryAt] = useState<((lat: number, lng: number) => string | null) | null>(null)
  useEffect(() => {
    void loadCountryAt().then((f) => setCountryAt(() => f))
  }, [])
  const hits = useMemo(() => (trip && countryAt ? countryEntries(trip.route, trip.routeKm, countryAt) : []), [trip?.id, trip?.route, trip?.routeKm, countryAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const progress = useMemo(() => (live && trip ? computeProgress(live, trip, now) : null), [live, trip, now])

  // a completed slot short of the destination only exists for a moment: the next slot follows at once and its card is queued
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
    if (flying && progress && (progress.done || progress.arrived) && !getState().session?.leftAtMs) void settleElapsedSlots()
  }, [flying, progress])

  // a mid-journey landing found on load (a reload between landing and continuing) flies on and queues its card
  useEffect(() => {
    if (midStop) recoverStranded()
  }, [midStop, landing?.storyId])

  // unread stop cards are shown before leaving for the landing page
  useEffect(() => {
    if (landing && !midStop && !session && cards.length === 0) nav(`/landing/${landing.storyId}`, { replace: true })
  }, [landing, midStop, session, cards.length, nav])

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
      else {
        const a = startAmbience()
        const c = startCoo()
        stop = () => (a(), c())
      }
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
  const km = !session && landing ? landing.km : (progress?.km ?? 0)
  const countdown = mmss(!session && landing ? landing.durationMin * 60000 : (progress?.remainingMs ?? 0))
  const pct = Math.round((km / trip.routeKm) * 100)
  const dismissHead = () => headCard && setState((st) => ({ stopCards: st.stopCards.filter((c) => c.storyId !== headCard.storyId) }))
  const endAction = observing ? (
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
  )

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
          turnRef={turnRef}
          className="absolute inset-0"
        />
        <div className="pointer-events-none absolute inset-0 bg-[rgba(255,248,244,0.18)]" />
        <WindStreaks wind={wind} />

        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
          <BirdViewer bird={species} flight turnRef={turnRef} className="h-44 w-60" />
        </div>

        {!midStop && live && <CountryStamps entered={enteredBetween(hits, live.baseKm, km)} />}

        <aside className="absolute right-4 top-3 w-[270px] max-w-[calc(100%-2rem)] rounded-2xl bg-white/90 p-3.5 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)] backdrop-blur-[6px]">
          <FlightHud
            dest={`${trip.dest.name}, ${trip.dest.country}`}
            countdown={countdown}
            pct={pct}
            stops={stops}
            routeKm={trip.routeKm}
            km={km}
            action={endAction}
          />
        </aside>

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 px-4 pb-6 pt-2">
          {observing && <p className="mx-auto rounded-full bg-card-soft/70 px-4 py-1 text-[16px] text-[rgba(142,77,49,0.9)]">Flying on your other device</p>}
          <div className="flex items-end justify-between">
            <div className="flex items-center gap-2">
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
            {popupSupported() && !win && flying && (
              <button type="button" onClick={() => void openPopup()} className="rounded-full bg-white/90 px-3 py-2.5 text-[13px] font-semibold text-ink-2 shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px]">
                Pop out
              </button>
            )}
            </div>
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
        {!win && headCard && headStory && (
          <StopCard
            story={headStory}
            newStampCc={headCard.newStampCc}
            covered={coveredBetween(hits, headCard.km - headCard.gainedKm, headCard.km)}
            queued={cards.length}
            onDone={dismissHead}
          />
        )}
        {win && flying && (
          <FlightPopup
            win={win}
            species={species}
            turnRef={turnRef}
            hud={{ dest: `${trip.dest.name}, ${trip.dest.country}`, countdown, pct, stops, routeKm: trip.routeKm, km, onEnd: () => void landSession('ended') }} // the confirm dialog lives in the hidden tab, so the popup lands directly
            card={headCard && headStory ? { story: headStory, newStampCc: headCard.newStampCc, covered: coveredBetween(hits, headCard.km - headCard.gainedKm, headCard.km), queued: cards.length, onDone: dismissHead } : null}
            onOpenTab={() => window.focus()}
          />
        )}

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
