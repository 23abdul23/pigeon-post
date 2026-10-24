import Avatar from '../components/Avatar'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import Flag from '../components/Flag'
import { Frame } from '../components/Layout'
import MiniMap from '../components/MiniMap'
import { fmtKm } from '../lib/geo'
import { dms } from './Landing'
import { playCoo } from '../lib/sound'
import { useStore } from '../lib/store'
import { toggleStorySaved } from '../lib/stories'

const BIRD_ICONS = [
  { icon: '/assets/sd-b1.svg', bg: 'bg-sky', w: 'h-[15px] w-[13.5px]', tag: 'Canopy' },
  { icon: '/assets/sd-b2.svg', bg: 'bg-[#c6ecd0]', w: 'h-[15px] w-3', tag: 'Gardens' },
  { icon: '/assets/sd-b3.svg', bg: 'bg-[#ffdbcd]', w: 'h-[12.8px] w-[16.5px]', tag: 'Rooftops' },
]

export default function JournalDetail() {
  const { storyId } = useParams()
  const nav = useNavigate()
  const stories = useStore((s) => s.stories)
  const home = useStore((s) => s.homeCity)
  const bird = useStore((s) => s.bird)
  const sorted = [...stories].sort((a, b) => b.dateMs - a.dateMs)
  const idx = sorted.findIndex((s) => s.id === storyId)
  const story = sorted[idx]
  if (!story) return <Navigate to="/journal" replace />

  const prev = sorted[idx + 1]
  const next = sorted[idx - 1]
  const d = new Date(story.dateMs)
  const name = bird?.name ?? 'Pip'
  const paras = story.text.split(/(?<=[.!?])\s+(?=[A-Z])/).reduce<string[]>((acc, s, i) => {
    if (i % 3 === 0) acc.push(s)
    else acc[acc.length - 1] += ` ${s}`
    return acc
  }, [])

  const toggleSave = () => toggleStorySaved(story.id)

  async function dispatch() {
    const text = `${story.place}, ${story.country}: ${story.text}`
    if (navigator.share) {
      try {
        await navigator.share({ title: story.place, text, url: story.sourceUrl })
      } catch {
        // dismissed
      }
    } else {
      nav(`/passport/share?story=${story.id}`)
    }
  }

  return (
    <Frame nav>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-cream/85 px-2 shadow-[0_1px_8px_rgba(62,58,54,0.04)] backdrop-blur-[12px]">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => nav('/journal')} aria-label="Go back" className="flex size-11 items-center justify-center rounded-full">
            <img src="/assets/tc-back.svg" alt="" className="size-4" />
          </button>
          <h1 className="max-w-[200px] truncate font-serif text-[20px] font-semibold leading-7 text-ink">Journal Story Detail</h1>
        </div>
        <Link to="/settings/profile" aria-label="Profile" className="flex size-11 items-center justify-center">
          <Avatar className="size-8" />
        </Link>
      </header>

      <main className="flex-1 pb-2">
        <div className="flex items-center justify-between px-5 pb-2 pt-1">
          <Link to="/journal" className="flex items-center gap-1 py-1 text-[12px] font-bold uppercase tracking-[0.6px] text-ink-2">
            <img src="/assets/sd-back.svg" alt="" className="size-3" />
            Back to journal
          </Link>
          <div className="flex items-center gap-1">
            <span className="-rotate-2 px-1 font-hand text-[22px] font-medium leading-7 text-[#8e4d31]">Dispatch #{String(sorted.length - idx).padStart(2, '0')}</span>
            <Link to={`/passport/share?story=${story.id}`} aria-label="Share story" className="flex size-8 items-center justify-center rounded-full">
              <img src="/assets/sd-share.svg" alt="" className="h-[16.7px] w-[15px]" />
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-4 px-5">
          <div className="relative max-h-[300px] overflow-hidden rounded-[20px] bg-[#efe7e1] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <img src={story.photo ?? '/assets/terrain-underlayer.jpg'} alt={`${story.place}`} className="h-[262px] w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(51,48,44,0.6)] via-[rgba(51,48,44,0)] to-[rgba(0,0,0,0.2)]" />
            <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-[rgba(255,248,244,0.9)] px-3 py-1 text-[12px] font-bold tracking-[0.36px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px]">
                <Flag cc={story.cc} className="w-4" />
                {story.region ?? story.place}, {story.country}
              </span>
              <span className="rounded-full bg-[rgba(68,102,80,0.9)] px-2.5 pb-[7px] pt-[9px] text-[12px] font-bold leading-4 tracking-[0.36px] text-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px]">{story.lens}</span>
            </div>
            <div className="absolute bottom-2 right-2 flex size-[62px] rotate-6 items-center justify-center opacity-85">
              <div className="flex size-14 flex-col items-center justify-center rounded-full bg-[rgba(244,236,230,0.85)] p-1 shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[2px]">
                <span className="text-[8px] uppercase tracking-[0.8px] text-ink-2">{story.country.slice(0, 5)}</span>
                <img src="/assets/sd-stamp.svg" alt="" className="size-3" />
                <span className="text-[7px] text-ink-2">{d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '.')}</span>
              </div>
            </div>
          </div>

          <section className="flex flex-col gap-2 rounded-[20px] bg-card p-4 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] font-bold uppercase tracking-[0.6px] text-sky-ink">{story.region ?? story.place}</span>
                <span className="whitespace-nowrap text-[11px] text-ink-2">
                  {dms(story.lat, 'N', 'S')}, {dms(story.lng, 'E', 'W')}
                </span>
              </div>
              <h2 className="pt-1 font-serif text-[24px] leading-[30px] text-ink">{story.place}</h2>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Chip icon="/assets/sd-cal.svg" w="h-[13.3px] w-3">{d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</Chip>
              <Chip icon="/assets/sd-route.svg" w="h-[12.1px] w-[13.8px]">{fmtKm(story.km)} flown</Chip>
              <Chip icon="/assets/sd-hourglass.svg" w="h-[13.3px] w-[10.7px]">{Math.max(1, Math.round(story.km / 100))} min Focus</Chip>
            </div>
          </section>

          <section className="overflow-hidden rounded-[20px] bg-[rgba(127,163,138,0.2)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <div className="flex items-start gap-2">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#7fa38a] shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                <img src="/assets/sd-bird.svg" alt="" className="h-[18.3px] w-[14.8px]" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-bold uppercase tracking-[0.6px] text-[#183926]">Field note from {name}</span>
                  <span className="text-[11px] text-ink-2">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="pt-[3px] font-serif text-[22px] leading-[30px] text-ink">“Rested near {story.region ?? story.place}. The whole sky was still ahead of me, and the air smelled of rain and warm bread.”</p>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-2 rounded-[20px] bg-white p-4 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <h3 className="flex items-center gap-2 font-serif text-[20px] font-bold leading-7 text-ink">
              <img src="/assets/sd-story.svg" alt="" className="h-[14.6px] w-[16.5px]" />
              About {story.place}
            </h3>
            <div className="flex flex-col gap-2 text-[16px] leading-[26px] text-ink">
              {paras.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            <p className="flex items-center gap-2 pt-1 text-[11px] leading-6 text-ink-2">
              <img src="/assets/sd-book.svg" alt="" className="h-[10.7px] w-[14.7px] shrink-0" />
              {story.sourceUrl ? (
                <a href={story.sourceUrl} target="_blank" rel="noreferrer" className="underline decoration-outline underline-offset-2">
                  Source: Wikipedia &amp; Field Survey #{400 + sorted.length - idx}
                </a>
              ) : (
                <span>Source: Field Survey #{400 + sorted.length - idx}</span>
              )}
            </p>
          </section>

          {story.birds.length > 0 && (
            <section className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.6px] text-sky-ink">Avian neighbors spotted</h3>
                <span className="text-[11px] text-ink-2">{story.birds.length} species cataloged</span>
              </div>
              <div className="flex gap-2">
                {story.birds.map((b, i) => {
                  const v = BIRD_ICONS[i % 3]
                  return (
                    <div key={b} className="flex min-w-0 flex-1 flex-col items-center rounded-xl bg-card p-2.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                      <span className={`mb-1.5 flex size-8 items-center justify-center rounded-full ${v.bg}`}>
                        <img src={v.icon} alt="" className={v.w} />
                      </span>
                      <span className="line-clamp-1 text-center text-[12px] font-bold leading-4 tracking-[0.36px] text-ink">{b}</span>
                      <span className="pt-0.5 text-[10px] text-ink-2">{v.tag}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <section className="flex flex-col gap-2 rounded-[20px] bg-card p-4 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.6px] text-ink">
                <img src="/assets/sd-way.svg" alt="" className="size-[15px]" />
                Flight waypoint
              </span>
              <span className="text-[11px] font-bold text-sage">Route Completed</span>
            </div>
            <MiniMap center={{ lat: story.lat, lng: story.lng }} zoom={5} className="h-32 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
                <span className="flex size-7 items-center justify-center rounded-full bg-[#8e4d31] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)]">
                  <img src="/assets/sd-pin.svg" alt="" className="size-[11.3px]" />
                </span>
                <span className="pt-0.5 text-[9px] font-bold uppercase tracking-[-0.2px] text-[#8e4d31]">{story.place.slice(0, 22)}</span>
              </div>
            </MiniMap>
            <div className="flex items-center justify-between px-1 text-[11px] leading-6 text-ink-2">
              <span>Origin: {home?.name ?? 'Home Roost'}</span>
              <span>{story.lat.toFixed(2)}°, {story.lng.toFixed(2)}°</span>
            </div>
          </section>

          <div className="flex items-center justify-between pt-1">
            <button type="button" disabled={!prev} onClick={() => prev && nav(`/journal/${prev.id}`)} className="flex items-center gap-1.5 rounded-full bg-card px-3 py-2 text-[12px] font-bold tracking-[0.36px] text-ink shadow-[0_1px_1px_rgba(0,0,0,0.05)] disabled:opacity-40">
              <img src="/assets/sd-prev.svg" alt="" className="h-2 w-[4.9px]" />
              {prev ? prev.place.split(',')[0].slice(0, 10) : 'Earlier'}
            </button>
            <span className="font-serif text-[18px] text-ink-2">
              {sorted.length - idx} of {sorted.length} journeys
            </span>
            <button type="button" disabled={!next} onClick={() => next && nav(`/journal/${next.id}`)} className="flex items-center gap-1.5 rounded-full bg-card px-3 py-2 text-[12px] font-bold tracking-[0.36px] text-ink shadow-[0_1px_1px_rgba(0,0,0,0.05)] disabled:opacity-40">
              {next ? next.place.split(',')[0].slice(0, 10) : 'Later'}
              <img src="/assets/sd-next.svg" alt="" className="h-2 w-[4.9px]" />
            </button>
          </div>

          <div className="flex flex-col gap-2 pb-6 pt-1">
            <div className="flex gap-2">
              <Action onClick={() => playCoo(true)} icon="/assets/sd-tram.svg" w="size-[16.7px]" label="Ambiance" />
              <Action onClick={toggleSave} icon="/assets/sd-keep.svg" w="h-[15px] w-[11.7px]" label={story.saved ? 'Saved' : 'Keepsake'} on={story.saved} />
              <Action onClick={() => void dispatch()} icon="/assets/sd-post.svg" w="h-[13.3px] w-[15.8px]" label="Post Dispatch" />
            </div>
            <button
              type="button"
              onClick={() => nav(`/trip/new?place=${encodeURIComponent([story.place, story.country, story.cc, story.lat, story.lng].join('|'))}`)}
              className="relative flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#d58767] text-[14px] font-bold uppercase tracking-[0.35px] text-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]"
            >
              <img src="/assets/sd-fly.svg" alt="" className="size-[18.3px]" />
              Fly here again
            </button>
          </div>
        </div>
      </main>
    </Frame>
  )
}

function Chip({ icon, w, children }: { icon: string; w: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-bold tracking-[0.36px] text-ink drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
      <img src={icon} alt="" className={w} />
      {children}
    </span>
  )
}

function Action({ onClick, icon, w, label, on }: { onClick: () => void; icon: string; w: string; label: string; on?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl py-2.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)] ${on ? 'bg-[#c6ecd0]' : 'bg-card'}`}>
      <img src={icon} alt="" className={w} />
      <span className="text-[11px] font-bold leading-6 text-ink">{label}</span>
    </button>
  )
}
