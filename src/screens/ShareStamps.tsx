import Avatar from '../components/Avatar'
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Frame } from '../components/Layout'
import Flag from '../components/Flag'
import { useStore } from '../lib/store'

type Format = 'story' | 'post' | 'square'
type Period = 'week' | 'month' | 'all'

const FORMATS: Record<Format, { label: string; ratio: string; w: number; h: number; icon: string; iw: string }> = {
  story: { label: 'Story (9:16)', ratio: '9 / 16', w: 1080, h: 1920, icon: '/assets/ss-story.svg', iw: 'h-[14.7px] w-2.5' },
  post: { label: 'Post (4:5)', ratio: '4 / 5', w: 1080, h: 1350, icon: '/assets/ss-post.svg', iw: 'h-[10.7px] w-3' },
  square: { label: 'Square (1:1)', ratio: '1 / 1', w: 1080, h: 1080, icon: '/assets/ss-square.svg', iw: 'size-3' },
}
const PALETTES = [
  { name: 'Warm Cream', c: '#faf4eb' },
  { name: 'Sage Mist', c: '#e5ece7' },
  { name: 'Vintage Sand', c: '#f2e7d8' },
  { name: 'Sky Parchment', c: '#eaf1f5' },
]
const FALLBACK = ['/assets/stamp-1.jpg', '/assets/stamp-2.jpg', '/assets/stamp-3.jpg', '/assets/stamp-4.jpg', '/assets/stamp-5.jpg', '/assets/stamp-6.jpg']
const ROT = ['-rotate-2', 'rotate-1', '-rotate-1', 'rotate-2', '-rotate-3', 'rotate-1']

export default function ShareStamps() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const stamps = useStore((s) => s.stamps)
  const stories = useStore((s) => s.stories)
  const sessions = useStore((s) => s.sessions)
  const user = useStore((s) => s.user)
  const home = useStore((s) => s.homeCity)
  const storyParam = params.get('story')
  const focusStory = stories.find((s) => s.id === storyParam)

  const [format, setFormat] = useState<Format>('post')
  const [period, setPeriod] = useState<Period>('all')
  const [palette, setPalette] = useState(0)
  const [showName, setShowName] = useState(true)
  const [picked, setPicked] = useState<string[] | null>(focusStory ? [focusStory.cc] : null)
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const card = useRef<HTMLDivElement>(null)

  const inPeriod = useMemo(() => {
    const now = Date.now()
    const span = period === 'week' ? 7 : period === 'month' ? 30 : 36500
    return stamps.filter((s) => now - s.firstMs < span * 86400000)
  }, [stamps, period])

  const chosen = (picked ? inPeriod.filter((s) => picked.includes(s.cc)) : inPeriod).slice(0, 6)
  const km = Math.round(sessions.reduce((a, s) => a + s.km, 0))
  const hrs = Math.round(sessions.reduce((a, s) => a + (s.endMs - s.startMs), 0) / 360000) / 10
  const title = period === 'week' ? 'This Week' : period === 'month' ? 'This Month' : 'All Time'
  const season = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  function toggle(cc: string) {
    const base = picked ?? inPeriod.map((s) => s.cc)
    setPicked(base.includes(cc) ? base.filter((c) => c !== cc) : [...base, cc].slice(0, 6))
  }

  async function render(): Promise<Blob | null> {
    if (!card.current) return null
    const { toBlob } = await import('html-to-image')
    const f = FORMATS[format]
    return toBlob(card.current, { pixelRatio: f.w / card.current.offsetWidth, cacheBust: true, backgroundColor: PALETTES[palette].c })
  }

  async function download() {
    setBusy(true)
    setMsg('')
    try {
      const blob = await render()
      if (!blob) throw new Error('no blob')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pigeon-post-${format}-${title.toLowerCase().replace(' ', '-')}.png`
      a.click()
      URL.revokeObjectURL(url)
      setMsg('Saved to your downloads.')
    } catch {
      setMsg("Couldn't build the image. Try again in a moment.")
    } finally {
      setBusy(false)
    }
  }

  async function instagram() {
    setBusy(true)
    setMsg('')
    try {
      const blob = await render()
      if (!blob) throw new Error('no blob')
      const file = new File([blob], 'pigeon-post.png', { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My Pigeon Post journeys' })
        setMsg('Shared.')
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'pigeon-post.png'
        a.click()
        URL.revokeObjectURL(url)
        setMsg('Image saved. Open Instagram and pick it from your gallery.')
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMsg("Couldn't share. Download the image instead.")
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText('https://pigeonpost.app')
      setMsg('Link copied.')
    } catch {
      setMsg('Copy is not available here.')
    }
  }

  const pal = PALETTES[palette].c

  return (
    <Frame>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-cream/85 px-2 shadow-[0_1px_8px_rgba(62,58,54,0.04)] backdrop-blur-[12px]">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => nav(-1)} aria-label="Go back" className="flex size-11 items-center justify-center rounded-full">
            <img src="/assets/tc-back.svg" alt="" className="size-4" />
          </button>
          <h1 className="font-serif text-[20px] font-semibold leading-7 text-ink">Share Stamps</h1>
        </div>
        <Link to="/settings/profile" aria-label="Profile" className="flex size-11 items-center justify-center">
          <Avatar className="size-8" />
        </Link>
      </header>

      <main className="flex-1 px-5 pb-8">
        <div className="flex items-center justify-between pb-3 pt-1">
          <p className="flex items-center gap-1 font-serif text-[22px] leading-7 text-[#8e4d31]">
            <img src="/assets/ss-ready.svg" alt="" className="h-[15px] w-[17.5px]" />
            Ready for parchment dispatch
          </p>
          <span className="shrink-0 rounded-full bg-card px-2 py-1 text-[12px] font-bold leading-4 tracking-[0.36px] text-ink-2">
            HQ
            <br />
            {FORMATS[format].w}×{FORMATS[format].h}
          </span>
        </div>

        <div className="flex justify-center py-1">
          <div className="relative w-full max-w-[340px] overflow-hidden rounded-3xl bg-card-soft p-3 shadow-[0_12px_32px_-8px_rgba(62,58,54,0.12)]">
            <div className="absolute inset-0 rounded-3xl opacity-30" style={{ backgroundImage: 'repeating-linear-gradient(135deg, #ba1a1a 0 10px, transparent 10px 20px, #476270 20px 30px, transparent 30px 40px)' }} aria-hidden />
            <div ref={card} className="relative overflow-hidden rounded-[18px] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]" style={{ background: pal, aspectRatio: FORMATS[format].ratio }}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-1">
                  <span className="flex size-8 items-center justify-center rounded-full bg-[rgba(127,163,138,0.3)]">
                    <img src="/assets/ss-logo.svg" alt="" className="h-[16.5px] w-[13.3px]" />
                  </span>
                  <div>
                    <p className="font-serif text-[15px] leading-[18.75px] tracking-[-0.375px] text-ink">
                      My Epistolary
                      <br />
                      Journeys · {title}
                    </p>
                    <p className="text-[10px] leading-6 text-ink-2">
                      {season}
                      {showName ? ` • ${user?.name ?? 'Traveler'}’s Roost` : ''}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="rotate-2 font-serif text-[16px] leading-4 text-[#8e4d31]">Expédition No.</p>
                  <p className="pt-3 text-[9px] uppercase leading-6 tracking-[0.45px] text-muted">Postmark valid</p>
                </div>
              </div>

              <svg viewBox="0 0 270 66" className="mt-2 h-[66px] w-full" aria-hidden>
                <path d="M 22 46 Q 70 8 124 30 T 190 28 T 248 40" fill="none" stroke="#446650" strokeWidth="1.2" strokeDasharray="3 3" />
                {chosen.slice(0, 4).map((s, i) => {
                  const x = [24, 118, 186, 246][i]
                  const y = [46, 32, 30, 40][i]
                  return (
                    <g key={s.cc}>
                      <circle cx={x} cy={y} r="2.2" fill="#8e4d31" />
                      <text x={x} y={y - 6} fontSize="6" fontWeight="700" fill="#476270" textAnchor="middle">
                        {(stories.find((st) => st.cc === s.cc)?.place ?? s.country).slice(0, 3).toUpperCase()}
                      </text>
                    </g>
                  )
                })}
              </svg>

              <div className="grid grid-cols-3 gap-2 p-1">
                {chosen.length === 0 && <p className="col-span-3 py-6 text-center font-hand text-[22px] leading-7 text-[#8e4d31]">Fly somewhere to collect your first stamp.</p>}
                {chosen.map((s, i) => {
                  const st = stories.find((x) => x.cc === s.cc)
                  return (
                    <div key={s.cc} className={`flex flex-col gap-0.5 rounded-[2px] bg-card p-1 drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)] ${ROT[i % 6]}`}>
                      <div className="relative h-11 overflow-hidden bg-line">
                        <img src={st?.photo ?? FALLBACK[i % 6]} alt="" crossOrigin="anonymous" className="size-full object-cover" />
                      </div>
                      <div className="flex items-center justify-between px-0.5">
                        <span className="truncate text-[8px] leading-6 text-ink">{(st?.region ?? st?.place ?? s.country).slice(0, 11)}</span>
                        <Flag cc={s.cc} className="w-2.5" />
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="absolute inset-x-4 bottom-4 flex items-center justify-between rounded-lg bg-[rgba(250,242,236,0.7)] px-2 pb-1.5 pt-2">
                <div className="flex items-center gap-2 text-[10px] font-bold leading-4 text-ink">
                  <span className="flex items-center gap-1">
                    <img src="/assets/ss-i1.svg" alt="" className="size-[10.8px]" />
                    {stamps.length + (home && !stamps.some((s) => s.cc === home.cc) ? 1 : 0)}
                    <br />
                    Countries
                  </span>
                  <span className="text-outline">•</span>
                  <span className="flex items-center gap-1">
                    <img src="/assets/ss-i2.svg" alt="" className="size-[9.8px]" />
                    {km.toLocaleString('en-US')}
                    <br />
                    km
                  </span>
                  <span className="text-outline">•</span>
                  <span className="flex items-center gap-1">
                    <img src="/assets/ss-i3.svg" alt="" className="h-[11.4px] w-[9.8px]" />
                    {hrs}
                    <br />
                    hrs
                  </span>
                </div>
                <span className="text-[9px] tracking-[-0.2px] text-muted">@pigeonpost.app</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 pb-2 pt-4" role="radiogroup" aria-label="Card format">
          {(Object.keys(FORMATS) as Format[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={format === k}
              onClick={() => setFormat(k)}
              className={`flex items-center gap-3 rounded-full py-1.5 pl-4 pr-5 text-left text-[12px] font-bold leading-4 tracking-[0.36px] ${format === k ? 'bg-[#7fa38a] text-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'bg-card text-ink-2'}`}
            >
              <img src={FORMATS[k].icon} alt="" className={`${FORMATS[k].iw} ${format === k ? '' : ''}`} />
              <span>
                {FORMATS[k].label.split(' ')[0]}
                <br />
                {FORMATS[k].label.split(' ')[1]}
              </span>
            </button>
          ))}
        </div>

        <section className="mt-1 flex flex-col gap-4 rounded-[22px] bg-card-soft p-4 drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
          <div className="flex flex-col gap-1">
            <p className="text-[12px] font-bold uppercase tracking-[0.6px] text-ink-2">Flight period</p>
            <div className="flex gap-1 rounded-full bg-card p-1">
              {(
                [
                  ['week', 'This week'],
                  ['month', 'This month'],
                  ['all', 'All time'],
                ] as [Period, string][]
              ).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setPeriod(k)} aria-pressed={period === k} className={`flex-1 rounded-full py-1.5 text-[12px] font-bold tracking-[0.36px] ${period === k ? 'bg-cream text-ink shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'text-ink-2'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-bold uppercase tracking-[0.6px] text-ink-2">
                Mounted stamps ({chosen.length}/{Math.min(6, inPeriod.length)})
              </p>
              <button type="button" onClick={() => setEditing(!editing)} className="flex items-center gap-0.5 text-[12px] font-bold tracking-[0.36px] text-sage">
                <img src="/assets/ss-edit.svg" alt="" className="size-[11.3px]" />
                {editing ? 'Done' : 'Edit stamps'}
              </button>
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1">
              {inPeriod.length === 0 && <span className="text-[12px] text-muted">No stamps in this period yet.</span>}
              {inPeriod.map((s) => {
                const on = chosen.some((c) => c.cc === s.cc)
                const st = stories.find((x) => x.cc === s.cc)
                return (
                  <button
                    key={s.cc}
                    type="button"
                    onClick={() => editing && toggle(s.cc)}
                    aria-pressed={on}
                    className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] text-[#4d6876] ${on ? 'bg-[rgba(202,231,248,0.4)]' : 'bg-card opacity-60'} ${editing ? 'ring-1 ring-sage/40' : ''}`}
                  >
                    {on && <img src="/assets/ss-chip.svg" alt="" className="h-[6.5px] w-[8.8px]" />}
                    {(st?.region ?? st?.place ?? s.country).slice(0, 14)}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="text-[12px] font-bold tracking-[0.36px] text-ink">Parchment Shade</p>
              <p className="text-[12px] leading-6 text-ink-2">Atmospheric background tint</p>
            </div>
            <div className="flex items-center gap-2" role="radiogroup" aria-label="Background tint">
              {PALETTES.map((p, i) => (
                <button
                  key={p.name}
                  type="button"
                  role="radio"
                  aria-checked={palette === i}
                  aria-label={p.name}
                  onClick={() => setPalette(i)}
                  className={`flex size-7 items-center justify-center rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${palette === i ? 'scale-110' : ''}`}
                  style={{ background: p.c }}
                >
                  {palette === i && <img src="/assets/ss-check.svg" alt="" className="h-2 w-[10.9px]" />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="text-[12px] font-bold tracking-[0.36px] text-ink">Show my name &amp; roost</p>
              <p className="text-[12px] leading-6 text-ink-2">Include personal callsign stamp</p>
            </div>
            <button type="button" role="switch" aria-checked={showName} aria-label="Show my name and roost" onClick={() => setShowName(!showName)} className={`flex h-7 w-12 items-center rounded-full p-0.5 transition-colors ${showName ? 'justify-end bg-sage' : 'justify-start bg-outline'}`}>
              <span className="size-6 rounded-full bg-cream shadow-[0_1px_2px_rgba(0,0,0,0.05)]" />
            </button>
          </div>
        </section>

        <div className="flex flex-col gap-2 pt-6">
          <button type="button" onClick={() => void download()} disabled={busy || chosen.length === 0} className="flex items-center justify-center gap-1 rounded-full bg-[#d58767] px-6 py-3.5 text-[14px] font-bold tracking-[0.28px] text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)] disabled:opacity-60">
            <img src="/assets/ss-download.svg" alt="" className="size-[13.3px]" />
            {busy ? 'Preparing…' : 'Download share card'}
          </button>
          <button type="button" onClick={() => void instagram()} disabled={busy || chosen.length === 0} className="flex items-center justify-center gap-1 rounded-full bg-card px-6 py-3 text-[14px] font-bold tracking-[0.28px] text-ink disabled:opacity-60">
            <img src="/assets/ss-camera.svg" alt="" className="h-[15px] w-[16.7px]" />
            Share directly to Instagram
          </button>
          <div className="flex justify-center pt-1">
            <button type="button" onClick={() => void copyLink()} className="flex items-center gap-1.5 py-1 text-[12px] font-bold tracking-[0.36px] text-sage">
              <img src="/assets/ss-link.svg" alt="" className="h-[6.7px] w-[13.3px]" />
              Copy postal link
            </button>
          </div>
          {msg && (
            <p role="status" className="text-center text-[13px] text-ink-2">
              {msg}
            </p>
          )}
        </div>
      </main>
    </Frame>
  )
}
