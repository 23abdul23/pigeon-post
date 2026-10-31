import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useStore } from '../lib/store'

export const RANGES = ['This week', 'Month', 'All time'] as const
export type FlightRange = (typeof RANGES)[number]

/** Places, countries, distance and focus hours for a time range; shared by the Flight Log dialog and the desktop dashboard card. */
export function useFlightStats(range: FlightRange) {
  const sessions = useStore((s) => s.sessions)
  const stories = useStore((s) => s.stories)
  const stamps = useStore((s) => s.stamps)
  return useMemo(() => {
    const now = Date.now()
    const span = range === 'This week' ? 7 : range === 'Month' ? 30 : 36500
    const inRange = sessions.filter((s) => now - s.endMs < span * 86400000)
    const places = stories.filter((s) => now - s.dateMs < span * 86400000).length
    const dist = Math.round(inRange.reduce((a, s) => a + s.km, 0))
    const hrs = inRange.reduce((a, s) => a + (s.endMs - s.startMs), 0) / 3600000
    return { places, dist, hrs: Math.round(hrs * 10) / 10, countries: stamps.length }
  }, [sessions, stories, stamps, range])
}

/** Navbar button plus the Flight Log dialog; lives in the Header so it is on every screen. */
export default function FlightLog() {
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<FlightRange>('This week')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const stats = useFlightStats(range)

  return (
    <>
      <button type="button" aria-label="Open Log Book" aria-haspopup="dialog" onClick={() => setOpen(true)} className="flex size-11 items-center justify-center rounded-full text-ink">
        <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
          <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />
          <path d="M9 7.5h6M9 11h4" />
        </svg>
      </button>
      {open && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Flight Log" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => setOpen(false)}>
          <div className="flex w-full max-w-[420px] flex-col gap-3 rounded-2xl bg-cream p-4 shadow-[0_8px_24px_rgba(62,58,54,0.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-serif text-[20px] font-semibold leading-7 text-ink">Flight Log</h2>
              <div className="flex items-center rounded-full bg-[#efe7e1] p-0.5" role="tablist" aria-label="Time range">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="tab"
                    aria-selected={range === r}
                    onClick={() => setRange(r)}
                    className={`rounded-full px-2.5 py-1 text-[11px] ${range === r ? 'bg-white text-ink shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'text-ink-2'}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <button type="button" autoFocus aria-label="Close Flight Log" onClick={() => setOpen(false)} className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-2">
                <img src="/assets/ic-close.svg" alt="" className="size-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Stat to="/journal" onNavigate={() => setOpen(false)} icon="/assets/ic-places.svg" iw="w-3 h-[15px]" label="Places" value={String(stats.places)} note={`${stats.places} stories collected`} />
              <Stat to="/passport" onNavigate={() => setOpen(false)} icon="/assets/ic-countries.svg" iw="size-[15px]" label="Countries" value={String(stats.countries)} note="Stamped in your passport" />
              <Stat icon="/assets/ic-distance.svg" iw="size-[13.5px]" label="Distance" value={stats.dist.toLocaleString('en-US')} unit="km" note="Flown with focus" />
              <Stat icon="/assets/ic-focus.svg" iw="w-3 h-[15px]" label="Focus" value={String(stats.hrs)} unit="hrs" note="Time in flight" />
            </div>
          </div>
        </div>,
        document.body, // the sticky blurred Header would otherwise be this fixed overlay's containing block
      )}
    </>
  )
}

function Stat({ icon, iw, label, value, unit, note, to, onNavigate }: { icon: string; iw: string; label: string; value: string; unit?: string; note: string; to?: string; onNavigate?: () => void }) {
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <img src={icon} alt="" className={iw} />
        <span className="text-[12px] font-semibold tracking-[0.36px] text-sky-ink">{label}</span>
      </div>
      <p className="font-serif text-[24px] leading-8 text-ink">
        {value}
        {unit && <span className="pl-1 text-[14px] text-ink-2">{unit}</span>}
      </p>
      <p className="text-[12px] leading-6 text-ink-2">{note}</p>
    </>
  )
  const cls = 'flex flex-col gap-1 rounded-2xl bg-card p-3.5 shadow-[0_1px_1px_rgba(0,0,0,0.05)]'
  return to ? (
    <Link to={to} onClick={onNavigate} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
