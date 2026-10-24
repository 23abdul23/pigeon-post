import Stamp from './Stamp'
import type { CountryHit } from '../lib/countriesAlong'

const MAX = 4

/** Stamps for countries the bird entered during this slot; display only (Passport stamps come from the landed story). */
export default function CountryStamps({ entered }: { entered: CountryHit[] }) {
  const shown = entered.slice(-MAX)
  const older = entered.length - shown.length
  return (
    <div aria-live="polite" className="pointer-events-none absolute left-4 top-[170px] z-10 flex flex-col items-start gap-1">
      {older > 0 && <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold text-ink-2">+{older}</span>}
      {shown.map((h, i) => (
        <span key={h.cc} className="country-stamp relative block h-[66px] w-[50px]" role="img" aria-label={`Entered ${h.country}`}>
          <span className="absolute left-0 top-0 origin-top-left scale-[0.4]">
            <Stamp cc={h.cc} country={h.country} tone={i} />
          </span>
        </span>
      ))}
    </div>
  )
}
