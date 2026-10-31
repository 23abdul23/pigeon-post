import type { ReactNode } from 'react'
import StopsRail from './StopsRail'

export type FlightHudProps = { dest: string; countdown: string; pct: number; stops: number[]; routeKm: number; km: number; action: ReactNode }

const CIRC = 2 * Math.PI * 20

/** The flight card body: countdown, destination, progress ring and stops rail. The caller positions it; the popup reuses it. */
export default function FlightHud({ dest, countdown, pct, stops, routeKm, km, action }: FlightHudProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.6px] text-ink-2">
          <span className="size-2 rounded-full bg-sage" />
          Focus flight
        </span>
        {action}
      </div>
      <div className="flex items-center justify-between pt-1">
        <div>
          <p className="font-serif text-[38px] font-semibold leading-[38px] tracking-[-0.95px] text-ink" aria-live="off">
            {countdown}
          </p>
          <p className="flex items-center gap-1 pt-1 text-[12px] font-semibold tracking-[0.36px] text-sky-ink">
            <img src="/assets/ic-nav-small.svg" alt="" className="size-[10.5px]" />
            <span className="max-w-[130px] truncate">{dest}</span>
          </p>
        </div>
        <div className="relative flex size-12 items-center justify-center" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Trip progress">
          <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
            <circle cx="24" cy="24" r="20" fill="none" stroke="#e9e1db" strokeWidth="4" />
            <circle cx="24" cy="24" r="20" fill="none" stroke="#446650" strokeWidth="4" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - Math.min(1, pct / 100))} />
          </svg>
          <span className="relative text-[12px] font-bold tracking-[0.36px] text-sage">{pct}%</span>
        </div>
      </div>
      <StopsRail stops={stops} fromKm={0} routeKm={routeKm} km={km} />
      <p className="pt-2 text-[14px] text-muted">
        Next stop in <span className="font-bold text-ink">{countdown}</span>
      </p>
    </>
  )
}
