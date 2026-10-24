import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Flag from '../components/Flag'
import Stamp from '../components/Stamp'
import { AppLayout } from '../components/Layout'
import { COUNTRIES, nextCountries } from '../lib/countries'
import { countryName } from '../lib/geo'
import { useStore } from '../lib/store'

type Period = 'all' | 'month' | 'year'

const ROT = ['-rotate-2', 'rotate-1', '-rotate-1', 'rotate-2']
export default function Passport() {
  const nav = useNavigate()
  const stamps = useStore((s) => s.stamps)
  const stories = useStore((s) => s.stories)
  const sessions = useStore((s) => s.sessions)
  const home = useStore((s) => s.homeCity)
  const user = useStore((s) => s.user)
  const [period, setPeriod] = useState<Period>('all')
  const [sort, setSort] = useState<'new' | 'az'>('new')
  const [locks, setLocks] = useState(true)
  const [open, setOpen] = useState<string | null>(null)

  const all = useMemo(() => {
    const list = [...stamps]
    if (home && !list.some((s) => s.cc === home.cc)) list.push({ cc: home.cc, country: home.country, firstMs: 0, visits: 0 })
    return list
  }, [stamps, home])

  const shown = useMemo(() => {
    const now = Date.now()
    const span = period === 'month' ? 30 : period === 'year' ? 365 : 36500
    return all
      .filter((s) => s.cc === home?.cc || now - s.firstMs < span * 86400000)
      .sort((a, b) => (sort === 'az' ? a.country.localeCompare(b.country) : b.firstMs - a.firstMs))
  }, [all, period, sort, home])

  const km = Math.round(sessions.reduce((a, s) => a + s.km, 0))
  const places = stories.length
  const visited = new Set(all.map((s) => s.cc))
  const locked = nextCountries(visited, home ?? { lat: 0, lng: 0 }, 4).map((c) => [c.cc, `${c.region} skies`] as const)
  const picked = shown.find((s) => s.cc === open)
  const pickedStories = picked ? stories.filter((s) => s.cc === picked.cc) : []
  const recordNo = `PP-${(((user?.email ?? 'guest').length * 7919) % 9000) + 1000}`

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 pb-4">
        <section className="relative overflow-hidden rounded-xl bg-[#7fa38a] p-6 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]">
          <span className="absolute -bottom-10 -right-10 size-44 rounded-full bg-[rgba(68,102,80,0.2)]" aria-hidden />
          <span className="absolute -left-6 -top-6 size-32 rounded-full bg-[rgba(255,255,255,0.1)]" aria-hidden />
          <div className="relative flex flex-col items-center">
            <span className="mb-2 flex size-16 items-center justify-center rounded-full bg-[rgba(250,242,236,0.2)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]">
              <span className="flex size-12 items-center justify-center rounded-full bg-[rgba(255,248,244,0.3)] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                <img src="/assets/pp-emblem.svg" alt="" className="size-[22.8px]" />
              </span>
            </span>
            <p className="px-8 text-center text-[12px] font-bold uppercase leading-4 tracking-[1.2px] text-card-soft">
              Republic of wings • traveler
              <br />
              passport
            </p>
            <h1 className="pt-0.5 font-serif text-[24px] leading-8 tracking-[-0.6px] text-cream">{user?.name ?? 'Wanderer'}'s Roost</h1>
            <span className="mt-1 flex items-center gap-1 rounded-full bg-[rgba(68,102,80,0.4)] px-4 py-1 text-[12px] font-bold tracking-[0.6px] text-cream shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <img src="/assets/pp-record.svg" alt="" className="h-3.5 w-[14.7px]" />
              OFFICIAL AVIARY RECORD #{recordNo}
            </span>
          </div>
        </section>

        <section className="flex flex-col gap-2 rounded-xl bg-card p-4 drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1 font-serif text-[20px] font-bold leading-7 text-ink">
              <img src="/assets/pp-log.svg" alt="" className="size-[16.7px]" />
              Flight Log
            </h2>
            <span className="rounded-full bg-sage px-2.5 py-0.5 text-[12px] font-bold tracking-[0.36px] text-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              {visited.size} of {COUNTRIES.length} countries ({Math.max(1, Math.round((visited.size / COUNTRIES.length) * 100))}%)
            </span>
          </div>
          <div className="flex gap-1 pt-1">
            <Metric value={String(visited.size)} label="Countries" tone="terracotta" icon="/assets/pp-countries.svg" />
            <Metric value={String(places)} label="Places" tone="sky" icon="/assets/pp-places.svg" />
            <Metric value={km.toLocaleString('en-US')} label="km Flown" tone="sage" />
          </div>
        </section>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1" role="tablist" aria-label="Period">
              {(
                [
                  ['all', 'All'],
                  ['month', 'This month'],
                  ['year', 'This year'],
                ] as [Period, string][]
              ).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={period === k} onClick={() => setPeriod(k)} className={`rounded-full px-3 py-1.5 text-[12px] font-bold tracking-[0.36px] ${period === k ? 'bg-sage text-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'bg-card text-ink-2'}`}>
                  {l}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1 rounded-full bg-card py-1.5 pl-2.5 pr-2 text-[12px] font-bold tracking-[0.36px] text-ink-2">
              <img src="/assets/pp-sort.svg" alt="" className="h-2 w-3" />
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort stamps" className="appearance-none bg-transparent outline-none">
                <option value="new">Newest</option>
                <option value="az">A to Z</option>
              </select>
              <img src="/assets/pp-chev.svg" alt="" className="h-[4.9px] w-2" />
            </label>
          </div>
          <div className="flex items-center justify-between px-1">
            <span className="flex items-center gap-1 text-[12px] font-bold tracking-[0.36px] text-ink-2">
              <img src="/assets/pp-eye.svg" alt="" className="h-2.5 w-[14.7px]" />
              Show unvisited locks
            </span>
            <button type="button" role="switch" aria-checked={locks} aria-label="Show unvisited locks" onClick={() => setLocks(!locks)} className={`flex h-6 w-10 items-center rounded-full p-0.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] transition-colors ${locks ? 'justify-end bg-sage' : 'justify-start bg-outline'}`}>
              <span className="size-5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]" />
            </button>
          </div>
        </div>

        {picked && (
          <section className="relative overflow-hidden rounded-xl bg-white p-4 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]" aria-label={`${picked.country} details`}>
            <span className="absolute -bottom-4 -right-4 size-20 rounded-full bg-[rgba(255,219,205,0.3)]" aria-hidden />
            <div className="relative flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-10 items-center justify-center rounded-lg bg-[#d58767]">
                  <Flag cc={picked.cc} className="w-6" />
                </span>
                <div>
                  <div className="flex items-center gap-1">
                    <h2 className="font-serif text-[20px] font-bold leading-7 text-ink">{picked.country}</h2>
                    <span className="rounded-full bg-[#ffdbcd] px-2 text-[11px] font-bold leading-6 text-[#360f00]">{picked.cc === home?.cc ? 'HOME' : 'ACTIVE'}</span>
                  </div>
                  <p className="text-[14px] text-ink-2">
                    {picked.firstMs ? `First visited: ${new Date(picked.firstMs).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} • ` : ''}
                    {picked.visits} flight{picked.visits === 1 ? '' : 's'} logged
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setOpen(null)} aria-label="Close details" className="pb-1.5">
                <img src="/assets/pp-close.svg" alt="" className="size-[11.7px]" />
              </button>
            </div>
            <button type="button" onClick={() => nav(`/journal?cc=${picked.cc}`)} disabled={pickedStories.length === 0} className="relative mt-2 flex w-full items-center justify-between rounded-lg bg-card-soft p-2 disabled:opacity-60">
              <span className="flex items-center gap-1 text-[12px] font-bold tracking-[0.36px] text-ink">
                <img src="/assets/pp-journal.svg" alt="" className="h-[14.6px] w-[16.5px]" />
                View {pickedStories.length} stor{pickedStories.length === 1 ? 'y' : 'ies'} in Journal
              </span>
              <img src="/assets/pp-arrow.svg" alt="" className="size-3" />
            </button>
          </section>
        )}

        <section className="relative rounded-xl bg-card-soft p-4 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]">
          <div className="flex h-7 items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-[0.6px] text-ink-2">Archival stamps</span>
            <span className="-rotate-2 font-serif text-[22px] leading-7 text-[#8e4d31]">Treasured miles</span>
          </div>
          {shown.length === 0 ? (
            <div className="py-10 text-center">
              <p className="font-serif text-[18px] text-ink">Your first stamp is one flight away.</p>
              <Link to="/home" className="mt-3 inline-block rounded-full bg-[#d58767] px-5 py-2.5 text-[14px] font-bold text-white">
                Start your first flight
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 pt-4">
              {shown.map((s, i) => {
                const last = stories.find((x) => x.cc === s.cc)
                const isHome = s.cc === home?.cc
                return (
                  <button
                    key={s.cc}
                    type="button"
                    onClick={() => setOpen(s.cc)}
                    aria-label={`${s.country} stamp`}
                    className={`flex flex-col text-left drop-shadow-[0_1px_2px_rgba(0,0,0,0.12)] ${ROT[i % 4]} ${open === s.cc ? 'ring-2 ring-[#d58767]/50' : ''}`}
                  >
                    <Stamp cc={s.cc} country={last?.region ?? last?.place ?? s.country} place={isHome && !s.firstMs ? undefined : last?.place} dateMs={s.firstMs || undefined} visits={s.visits} tone={i} className="mx-auto" />
                  </button>
                )
              })}
              {locks &&
                locked.map(([cc, hint]) => (
                  <div key={cc} className="flex flex-col rounded-lg bg-card p-2 opacity-70" aria-label={`${countryName(cc)} stamp, locked`}>
                    <div className="flex flex-col items-center p-1">
                      <div className="flex w-full items-center justify-between pb-1 text-[10px] font-bold tracking-[0.5px] text-ink-2">
                        <span className="flex items-center gap-1">
                          <Flag cc={cc} className="w-3" />
                          {cc}
                        </span>
                        <img src="/assets/pp-lock-s.svg" alt="" className="h-[10.5px] w-2" />
                      </div>
                      <span className="my-1 flex size-14 items-center justify-center rounded-full bg-[#efe7e1]">
                        <img src="/assets/pp-lock-b.svg" alt="" className="h-[19px] w-[10.9px]" />
                      </span>
                      <span className="font-serif text-[20px] font-bold leading-7 text-ink-2">{countryName(cc)}</span>
                      <span className="text-[12px] font-bold tracking-[0.36px] text-muted">{hint}</span>
                      <span className="pt-1 text-[12px] font-bold tracking-[0.36px] text-muted">LOCKED</span>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>

        <div className="flex flex-col items-center pt-1">
          <button type="button" onClick={() => nav('/passport/share')} className="relative flex w-full items-center justify-center gap-1 rounded-full bg-[#d58767] px-6 py-3.5 text-[14px] font-bold uppercase tracking-[0.35px] text-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]">
            <img src="/assets/pp-spark.svg" alt="" className="size-[18.3px]" />
            Share stamps
            <img src="/assets/af-share.svg" alt="" className="h-[15px] w-[13.5px] brightness-0 invert" />
          </button>
          <p className="px-3 pt-3 text-center font-serif text-[22px] leading-7 text-ink-2">“Every stamp is a quiet hour spent in the clouds.”</p>
        </div>
      </div>
    </AppLayout>
  )
}

function Metric({ value, label, tone, icon }: { value: string; label: string; tone: 'terracotta' | 'sky' | 'sage'; icon?: string }) {
  const c = tone === 'terracotta' ? 'text-[#8e4d31]' : tone === 'sky' ? 'text-sky-ink' : 'text-sage'
  return (
    <div className="flex flex-1 flex-col items-center gap-1 rounded-lg bg-card-soft px-1 pb-2 pt-1">
      {icon && <img src={icon} alt="" className="hidden h-[13.4px] w-[18.2px]" />}
      <span className={`font-serif text-[20px] font-bold leading-7 ${c}`}>{value}</span>
      <span className="text-[12px] font-bold tracking-[0.36px] text-ink-2">{label}</span>
    </div>
  )
}
