import { useId } from 'react'
import Flag from './Flag'

export const TINTS = [
  { bg: 'bg-[rgba(255,219,205,0.3)]', ink: 'text-[#8e4d31]', ring: 'bg-[rgba(213,135,103,0.3)]' },
  { bg: 'bg-[rgba(233,225,219,0.6)]', ink: 'text-ink-2', ring: 'bg-[rgba(244,236,230,0.8)]' },
  { bg: 'bg-[rgba(202,231,248,0.5)]', ink: 'text-[#2f4a58]', ring: 'bg-[rgba(202,231,248,0.6)]' },
  { bg: 'bg-[rgba(255,181,151,0.4)]', ink: 'text-[#360f00]', ring: 'bg-[rgba(213,135,103,0.3)]' },
  { bg: 'bg-[rgba(174,203,219,0.4)]', ink: 'text-sky-ink', ring: 'bg-[rgba(202,231,248,0.4)]' },
  { bg: 'bg-[rgba(198,236,208,0.5)]', ink: 'text-[#183926]', ring: 'bg-[rgba(127,163,138,0.4)]' },
  { bg: 'bg-[rgba(255,219,205,0.4)]', ink: 'text-[#8e4d31]', ring: 'bg-[rgba(213,135,103,0.3)]' },
]

// Perforated edge: holes along the 5px border ring, solid inside (union of the two mask layers).
const PERF = 'radial-gradient(circle at 5px 5px, transparent 3px, #000 3.5px) -5px -5px / 10px 10px, linear-gradient(#000, #000) center / calc(100% - 10px) calc(100% - 10px) no-repeat'
const maskStyle = { WebkitMask: PERF, mask: PERF } as const

const fmt = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()

export default function Stamp({ cc, country, place, dateMs, visits, size = 'sm', tone = 0, className = '' }: { cc: string; country: string; place?: string; dateMs?: number; visits?: number; size?: 'sm' | 'lg'; tone?: number; className?: string }) {
  const t = TINTS[tone % TINTS.length]
  const id = useId()
  const lg = size === 'lg'
  const label = [place && place.length > 14 ? `${place.slice(0, 13)}.` : place, dateMs ? fmt(dateMs) : ''].filter(Boolean).join(' · ') || 'HOME'
  const denom = visits === undefined ? '' : `${visits} flight${visits === 1 ? '' : 's'}`
  return (
    <span className={`relative inline-block shrink-0 ${lg ? 'h-[240px] w-[180px]' : 'h-[164px] w-[123px]'} ${className}`}>
      <span className="absolute inset-0 flex flex-col bg-white p-[9px]" style={maskStyle}>
        <span className={`relative flex flex-1 flex-col items-center overflow-hidden rounded-[2px] ${t.bg} p-1`}>
          <span className="relative block aspect-[4/3] w-full">
            <Flag cc={cc} className="!block !h-full !w-full !rounded-[1px]" />
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-black/10" aria-hidden />
          </span>
          <span className={`mt-1 max-w-full truncate font-serif font-bold leading-tight text-ink ${lg ? 'text-[20px]' : 'text-[14px]'}`}>{country}</span>
          <span className={`mt-auto self-start pb-0.5 pl-0.5 font-bold uppercase tracking-[0.5px] ${t.ink} ${lg ? 'text-[11px]' : 'text-[8px]'}`}>
            {cc}
            {denom && ` · ${denom}`}
          </span>
        </span>
      </span>
      <svg viewBox="0 0 80 80" className={`pointer-events-none absolute -bottom-4 -right-4 -rotate-12 ${t.ink} ${lg ? 'size-[88px]' : 'size-[54px]'}`} aria-hidden>
        <defs>
          <path id={id} d="M40 40 m-27 0 a27 27 0 1 1 54 0 a27 27 0 1 1 -54 0" />
        </defs>
        <circle cx="40" cy="40" r="37" fill="rgba(255,255,255,0.55)" stroke="currentColor" strokeWidth="2" />
        <circle cx="40" cy="40" r="20" fill="none" stroke="currentColor" strokeWidth="1" />
        <text fontSize="8" fontWeight="700" letterSpacing="0.5" fill="currentColor">
          <textPath href={`#${id}`} startOffset="0">
            {label.toUpperCase()}
          </textPath>
        </text>
        <text x="40" y="43" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor">{cc.toUpperCase()}</text>
      </svg>
    </span>
  )
}
