import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import Flag from '../components/Flag'
import Stamp from '../components/Stamp'
import StoryDetails from '../components/StoryDetails'
import { Frame } from '../components/Layout'
import { clearStopCards, startReturn } from '../lib/flight'
import { playCoo } from '../lib/sound'
import { setState, useStore } from '../lib/store'
import { toggleStorySaved } from '../lib/stories'

export const dms = (v: number, pos: string, neg: string) => {
  const a = Math.abs(v)
  const d = Math.floor(a)
  const m = Math.round((a - d) * 60)
  return `${d}° ${String(m).padStart(2, '0')}′ ${v >= 0 ? pos : neg}`
}

const BIRD_ICONS = [
  { icon: '/assets/ic-bird-1.svg', bg: 'bg-sky', w: 'h-[18.3px] w-[14.8px]', tag: 'Canopy' },
  { icon: '/assets/ic-bird-2.svg', bg: 'bg-[#c6ecd0]', w: 'h-[14.2px] w-[16.7px]', tag: 'Gardens' },
  { icon: '/assets/ic-bird-3.svg', bg: 'bg-[#ffdbcd]', w: 'size-[12.5px]', tag: 'Rooftops' },
]

export default function Landing() {
  const { storyId } = useParams()
  const nav = useNavigate()
  const stories = useStore((s) => s.stories)
  const landing = useStore((s) => s.landing)
  const trip = useStore((s) => s.trip)
  const stamps = useStore((s) => s.stamps)
  const bird = useStore((s) => s.bird)
  const friends = useStore((s) => s.friends)
  const letters = useStore((s) => s.letters)
  const idx = stories.findIndex((s) => s.id === storyId)
  const story = stories[idx]
  if (!story) return <Navigate to="/home" replace />

  const when = new Date(story.dateMs)
  const isNew = landing?.storyId === story.id && !!landing.newStampCc
  const here = landing?.storyId === story.id
  const delivered = here && trip?.status === 'DELIVERED'
  const returned = here && trip?.status === 'DONE' && !!trip.friendId
  const peer = friends.find((f) => f.id === trip?.friendId)
  const picked = letters.filter((l) => l.toId === 'me' && l.status === 'CARRIED').length
  const waiting = letters.filter((l) => l.toId === 'me' && l.status === 'DELIVERED').length
  const stampNo = stamps.findIndex((s) => s.cc === story.cc) + 1

  function leave() {
    if (landing) clearStopCards(landing.tripId)
    setState({ landing: null })
    nav('/home')
  }

  function flyHome() {
    const t = startReturn()
    if (t) nav(`/fly/${t.id}`, { replace: true })
  }

  function openMailbox() {
    if (landing) clearStopCards(landing.tripId)
    setState({ landing: null })
    nav('/mailbox')
  }

  const toggleSave = () => toggleStorySaved(story.id)

  return (
    <Frame nav>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-cream/80 px-4 shadow-[0_1px_8px_rgba(62,58,54,0.04)] backdrop-blur-[12px]">
        <button type="button" onClick={leave} aria-label="Close" className="flex size-11 items-center justify-center rounded-full">
          <img src="/assets/ic-close.svg" alt="" className="size-3.5" />
        </button>
        <h1 className="truncate px-2 font-serif text-[20px] font-semibold leading-7 tracking-[-0.5px] text-ink">{story.place}</h1>
        <Link to="/settings/profile" aria-label="Profile" className="flex size-8 items-center justify-center rounded-full">
          <Avatar className="size-8" />
        </Link>
      </header>

      <main className="flex-1 px-4 pb-28">
        <div className="pt-4">
          <div className="relative overflow-hidden rounded-3xl bg-line shadow-[0_4px_20px_-4px_rgba(62,58,54,0.08)]">
            <div className="relative h-[268px]">
              <img src={story.photo ?? '/assets/terrain-underlayer.jpg'} alt={story.photo ? `${story.place}` : ''} className="absolute inset-0 size-full object-cover" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(30,27,24,0.4)] via-[rgba(30,27,24,0)] to-[rgba(0,0,0,0.25)]" />
            <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-[rgba(255,248,244,0.95)] px-3 py-1.5 text-[12px] font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px]">
                <Flag cc={story.cc} className="w-4" />
                {story.region ?? story.place}, {story.country}
              </span>
              <span className="rounded-full bg-[rgba(68,102,80,0.9)] px-3 py-1.5 text-[12px] font-bold uppercase tracking-[1.2px] text-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px]">
                {story.lens}
              </span>
            </div>
            <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-[rgba(255,248,244,0.85)] px-2.5 py-1 text-[12px] font-semibold tracking-[0.36px] text-sky-ink backdrop-blur-[6px]">
              <img src="/assets/ic-compass-chip.svg" alt="" className="size-[11.7px]" />
              {story.region ?? story.country}
            </span>
          </div>
        </div>

        <article className="relative mt-6 flex flex-col gap-3 overflow-hidden rounded-[20px] bg-card-soft p-5 shadow-[0_2px_12px_-2px_rgba(62,58,54,0.05)]">
          <div className="absolute -right-10 -top-10 size-36 rounded-full bg-[rgba(68,102,80,0.05)]" aria-hidden />
          {(delivered || returned) && (
            <div role="status" className="relative rounded-xl bg-[#c6ecd0] p-3.5">
              {delivered ? (
                <>
                  <p className="font-serif text-[16px] font-semibold text-[#002110]">Letter delivered{peer ? ` to ${peer.name}` : ''}</p>
                  <p className="text-[14px] text-[#2c4e39]">
                    {picked > 0 ? `${picked} repl${picked > 1 ? 'ies' : 'y'} picked up for the flight home.` : 'No reply yet, but the door is open.'}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-serif text-[16px] font-semibold text-[#002110]">{bird?.name ?? 'Your bird'} is home</p>
                  <p className="text-[14px] text-[#2c4e39]">{waiting > 0 ? `${waiting} letter${waiting > 1 ? 's' : ''} waiting in your mailbox.` : 'No new letters this time.'}</p>
                </>
              )}
            </div>
          )}
          <div className="relative flex flex-col gap-1">
            <div className="flex items-center justify-end gap-2">
              <span className="whitespace-nowrap text-[12px] font-semibold tracking-[0.36px] text-sky-ink">
                {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <h2 className="font-serif text-[32px] leading-10 text-ink">{story.place}</h2>
            <p className="flex items-center gap-1.5 text-[14px] font-medium leading-5 text-sky-ink">
              <img src="/assets/ic-pin-line.svg" alt="" className="h-[12.5px] w-[8.75px]" />
              {story.region ? `${story.region} • ` : ''}
              {dms(story.lat, 'N', 'S')}, {dms(story.lng, 'E', 'W')}
            </p>
          </div>

          <p className="text-[16px] leading-[26px] text-ink-2">{story.text}</p>

          <StoryDetails extras={story.extras} />

          {story.birds.length > 0 && (
            <div className="flex flex-col gap-2 pb-3 pt-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[14px] font-bold uppercase tracking-[0.35px] text-ink">Avian neighbors spotted</h3>
                <span className="text-[12px] font-medium tracking-[0.36px] text-sage">{story.birds.length} Recorded</span>
              </div>
              <div className="flex gap-2">
                {story.birds.map((b, i) => {
                  const v = BIRD_ICONS[i % 3]
                  return (
                    <div key={b} className="flex min-w-0 flex-1 flex-col items-center rounded-xl bg-white p-2.5 drop-shadow-[0_1px_1.5px_rgba(62,58,54,0.03)]">
                      <span className={`mb-1.5 flex size-10 items-center justify-center rounded-full ${v.bg}`}>
                        <img src={v.icon} alt="" className={v.w} />
                      </span>
                      <span className="line-clamp-2 text-center text-[12px] font-semibold leading-[16.5px] tracking-[0.36px] text-ink">{b}</span>
                      <span className="pt-0.5 text-[12px] tracking-[0.36px] text-sky-ink">{v.tag}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {isNew && (
            <div className="relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl bg-line p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)] min-[420px]:flex-row">
              <Stamp size="lg" cc={story.cc} country={story.country} place={story.place} dateMs={story.dateMs} visits={stamps.find((x) => x.cc === story.cc)?.visits} />
              <div className="min-w-0 flex-1 pt-0.5 min-[420px]:pl-3.5">
                <span className="flex w-fit items-center rounded bg-[#ffdbcd] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px] text-[#71361c]">
                  <img src="/assets/ic-ribbon.svg" alt="" className="h-[10.5px] w-2" />
                  <span className="pl-1">New stamp collected</span>
                </span>
                <h4 className="truncate pt-1 font-serif text-[20px] font-semibold leading-[25px] text-ink">{story.country} Air Post</h4>
                <p className="text-[14px] leading-[17.5px] text-ink-2">Archived into your Field Album #{String(stampNo).padStart(2, '0')}</p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-4">
            <span className="flex min-w-0 items-center text-[14px] text-sky-ink">
              <img src="/assets/ic-book.svg" alt="" className="h-[10.7px] w-[14.7px] shrink-0" />
              <span className="truncate pl-1.5">{story.sourceUrl ? 'Wikipedia & Field Notes' : 'Field Notes'}</span>
            </span>
            {story.sourceUrl && (
              <a href={story.sourceUrl} target="_blank" rel="noreferrer" aria-label="View source citation" className="flex items-center justify-center px-1 pb-2.5 pt-1">
                <img src="/assets/ic-external.svg" alt="" className="size-3" />
              </a>
            )}
          </div>
        </article>
      </main>

      <div className="sticky bottom-0 z-30 bg-[rgba(255,248,244,0.9)] px-4 py-3 shadow-[0_-4px_24px_rgba(62,58,54,0.06)] backdrop-blur-[12px]">
        <div className="flex items-center gap-5">
          <div className="flex items-center">
            <button type="button" onClick={() => playCoo()} aria-label="Play a coo" className="flex size-11 items-center justify-center rounded-full bg-card">
              <img src="/assets/ic-speaker.svg" alt="" className="h-[14.6px] w-[15px]" />
            </button>
            <button type="button" onClick={toggleSave} aria-pressed={story.saved} aria-label={story.saved ? 'Remove from journal' : 'Save story to journal'} className={`ml-1 flex size-11 items-center justify-center rounded-full ${story.saved ? 'bg-[#c6ecd0]' : 'bg-card'}`}>
              <img src="/assets/ic-bookmark.svg" alt="" className="h-[15px] w-[11.7px]" />
            </button>
            <Link to={`/passport/share?story=${story.id}`} aria-label="Share postcard story" className="ml-1 flex size-11 items-center justify-center rounded-full bg-card">
              <img src="/assets/ic-share.svg" alt="" className="h-[17.5px] w-[13.3px]" />
            </Link>
          </div>
          <button
            type="button"
            onClick={delivered ? flyHome : returned && waiting > 0 ? openMailbox : leave}
            className="flex h-12 max-w-[190px] flex-1 items-center justify-center rounded-full bg-[#d58767] px-4 text-[14px] font-bold tracking-[0.28px] text-[#572309] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)]"
          >
            {delivered ? 'Fly home' : returned && waiting > 0 ? 'Open mailbox' : returned || trip?.status === 'DONE' ? 'Back home' : 'Continue journey'}
            <img src="/assets/ic-arrow-long.svg" alt="" className="ml-1.5 h-[10.5px] w-[15px]" />
          </button>
        </div>
      </div>
    </Frame>
  )
}
