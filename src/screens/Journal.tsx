import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Flag from '../components/Flag'
import { AppLayout } from '../components/Layout'
import { playCoo } from '../lib/sound'
import { useStore, type Story } from '../lib/store'
import { toggleStorySaved } from '../lib/stories'

const LENSES: Story['lens'][] = ['Hidden spot', 'Nature', 'Food', 'Legend', 'History']
const TAPES = [
  { cls: 'left-1/2 top-[-13px] h-6 w-28 -translate-x-1/2 -rotate-[1.5deg] bg-[#ffdbcd]' },
  { cls: 'right-6 top-[-12px] h-5 w-20 rotate-3 bg-[#aacfb5]' },
  { cls: 'left-6 top-[-9px] h-5 w-16 -rotate-[2.5deg] bg-[#ffb597]' },
]

export default function Journal() {
  const [params, setParams] = useSearchParams()
  const stories = useStore((s) => s.stories)
  const bird = useStore((s) => s.bird)
  const tab = params.get('tab') === 'saved' ? 'saved' : 'all'
  const cc = params.get('cc') ?? ''
  const lens = (params.get('lens') as Story['lens'] | null) ?? null
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'new' | 'old' | 'country'>('new')

  const countries = useMemo(() => [...new Map(stories.map((s) => [s.cc, s.country])).entries()], [stories])
  const saved = stories.filter((s) => s.saved)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = tab === 'saved' ? saved : stories
    if (cc) list = list.filter((s) => s.cc === cc)
    if (lens) list = list.filter((s) => s.lens === lens)
    if (needle) list = list.filter((s) => `${s.place} ${s.country} ${s.text} ${s.lens}`.toLowerCase().includes(needle))
    return [...list].sort((a, b) => (sort === 'old' ? a.dateMs - b.dateMs : sort === 'country' ? a.country.localeCompare(b.country) : b.dateMs - a.dateMs))
  }, [stories, saved, tab, cc, lens, q, sort])

  function setParam(k: string, v: string | null) {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }


  return (
    <AppLayout>
      <div className="flex flex-col pb-8">
        <div className="flex flex-col gap-1 pb-2 pt-4">
          <h1 className="font-serif text-[32px] leading-10 text-ink">Journal</h1>
        </div>

        <div className="py-4">
          <div className="flex rounded-full bg-[#efe7e1] p-1 shadow-[0_1px_1px_rgba(0,0,0,0.05)]" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'all'}
              onClick={() => setParam('tab', null)}
              className={`flex flex-1 items-center justify-center rounded-full p-2 text-[14px] font-bold tracking-[0.28px] ${tab === 'all' ? 'bg-white text-sage shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'text-ink-2'}`}
            >
              All Stories ({stories.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'saved'}
              onClick={() => setParam('tab', 'saved')}
              className={`flex flex-1 items-center justify-center gap-1 rounded-full p-2 text-[14px] font-bold tracking-[0.28px] ${tab === 'saved' ? 'bg-white text-sage shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'text-ink-2'}`}
            >
              <img src="/assets/jn-saved.svg" alt="" className="h-3 w-[9.3px]" />
              Saved Keepsakes ({saved.length})
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 pb-6">
          <div className="relative">
            <img src="/assets/tc-search.svg" alt="" className="pointer-events-none absolute left-3.5 top-1/2 size-[15px] -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search places, folklore, notes..."
              aria-label="Search journal"
              className="h-11 w-full rounded-full bg-card-soft pl-10 pr-4 text-[14px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] outline-none placeholder:text-muted focus:ring-2 focus:ring-sage/40"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="relative flex items-center gap-1.5 rounded-full bg-card py-1.5 pl-3.5 pr-3 text-[12px] font-bold tracking-[0.36px] text-ink shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <img src="/assets/jn-globe.svg" alt="" className="size-[13.3px]" />
              <select value={cc} onChange={(e) => setParam('cc', e.target.value || null)} aria-label="Filter by country" className="appearance-none bg-transparent pr-1 outline-none">
                <option value="">All countries ({countries.length})</option>
                {countries.map(([c, n]) => (
                  <option key={c} value={c}>
                    {n}
                  </option>
                ))}
              </select>
              <img src="/assets/jn-chev.svg" alt="" className="h-[4.9px] w-2" />
            </label>
            <label className="relative flex items-center gap-1 rounded-full bg-card py-1.5 pl-3 pr-3 text-[12px] font-bold tracking-[0.36px] text-ink-2 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <img src="/assets/jn-sort.svg" alt="" className="h-[13.3px] w-[10.7px]" />
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort stories" className="appearance-none bg-transparent pr-1 outline-none">
                <option value="new">Newest first</option>
                <option value="old">Oldest first</option>
                <option value="country">Country</option>
              </select>
              <img src="/assets/jn-chev.svg" alt="" className="h-[4.9px] w-2" />
            </label>
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1">
            <Pill on={!lens} onClick={() => setParam('lens', null)}>
              All
            </Pill>
            {LENSES.map((l) => (
              <Pill key={l} on={lens === l} onClick={() => setParam('lens', l)}>
                {l} ({stories.filter((s) => s.lens === l).length})
              </Pill>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="rounded-2xl bg-card-soft p-8 text-center">
            <img src="/assets/jn-epi.svg" alt="" className="mx-auto mb-2 size-6 opacity-60" />
            <p className="font-serif text-[18px] text-ink">{stories.length === 0 ? 'Your journal starts with your first landing.' : tab === 'saved' ? 'No keepsakes yet.' : 'Nothing matches those filters.'}</p>
            <p className="pt-1 text-[14px] text-ink-2">{stories.length === 0 ? 'Take a short flight and the first page will appear here.' : 'Try a different search or clear a filter.'}</p>
            {stories.length === 0 && (
              <Link to="/home" className="mt-4 inline-block rounded-full bg-[#8e4d31] px-5 py-2.5 text-[14px] font-bold text-white">
                Start a flight
              </Link>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {shown.map((s, i) => (
              <article key={s.id} className="relative flex flex-col gap-2 rounded-[20px] bg-card-soft p-4 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]">
                <span className={`absolute rounded-[2px] opacity-90 shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${TAPES[i % 3].cls}`} aria-hidden />
                <Link to={`/journal/${s.id}`} aria-label={`Read ${s.place}`} className="relative block h-[232px] overflow-hidden rounded-xl bg-card shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]">
                  <img src={s.photo ?? '/assets/terrain-underlayer.jpg'} alt="" className="absolute inset-0 size-full object-cover" />
                  <span className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[12px] font-bold tracking-[0.36px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px]">
                    <img src="/assets/jn-arrived.svg" alt="" className="h-[10.6px] w-3" />
                    Arrived by {bird?.name ?? 'Pip'}
                  </span>
                </Link>
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="flex items-center gap-1 rounded-full bg-sky px-2.5 py-0.5 text-[12px] font-bold tracking-[0.36px] text-[#4d6876]">
                    <Flag cc={s.cc} className="w-3.5" />
                    {s.region ? `${s.region}, ` : ''}
                    {s.country}
                  </span>
                  <span className="rounded-full bg-[#efe7e1] px-2.5 py-0.5 text-[12px] font-bold tracking-[0.36px] text-ink-2">{s.lens}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <h2 className="font-serif text-[24px] leading-8 tracking-[-0.6px] text-ink">{s.place}</h2>
                  <p className="line-clamp-2 text-[14px] leading-[22.75px] text-ink-2">{s.text}...</p>
                </div>
                <div className="flex items-center justify-between border-t border-outline/30 pt-[9px]">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold tracking-[0.36px] text-muted">{new Date(s.dateMs).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                    <span className="text-[16px] text-muted/50">•</span>
                    <button type="button" onClick={() => playCoo()} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold tracking-[0.36px] ${i === 0 ? 'bg-[#c6ecd0] text-[#2c4e39]' : 'bg-card text-ink-2'}`}>
                      <img src="/assets/jn-audio.svg" alt="" className="h-[13.3px] w-3" />
                      coo replay
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleStorySaved(s.id)}
                      aria-pressed={s.saved}
                      aria-label={s.saved ? 'Remove from keepsakes' : 'Save to keepsakes'}
                      className={`flex size-8 items-center justify-center rounded-full ${s.saved ? 'bg-[rgba(255,181,151,0.4)]' : ''}`}
                    >
                      <img src={s.saved ? '/assets/jn-bm-on.svg' : '/assets/jn-bm-off.svg'} alt="" className="h-[13.5px] w-[10.5px]" />
                    </button>
                    <Link to={`/journal/${s.id}`} aria-label={`Read ${s.place}`} className="flex size-8 items-center justify-center rounded-full bg-[#efe7e1]">
                      <img src="/assets/jn-read.svg" alt="" className="size-3" />
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="pb-4 pt-8">
          <div className="flex flex-col items-center rounded-2xl bg-card-soft p-6 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-[rgba(127,163,138,0.2)]">
              <img src="/assets/jn-epi.svg" alt="" className="size-[18.3px]" />
            </span>
            <span className="flex items-center gap-2 pt-2">
              <span className="h-px w-8 bg-outline" />
              <img src="/assets/jn-leaf.svg" alt="" className="size-[9.3px]" />
              <span className="h-px w-8 bg-outline" />
            </span>
            <p className="pt-1 text-center text-[12px] font-bold tracking-[0.36px] text-muted">Pigeon Post Archive • Volume III</p>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-bold tracking-[0.36px] shadow-[0_1px_1px_rgba(0,0,0,0.05)] ${on ? 'bg-sage text-white' : 'bg-card-soft text-ink-2'}`}
    >
      {children}
    </button>
  )
}
