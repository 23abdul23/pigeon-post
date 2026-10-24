import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Avatar from './Avatar'
import FlightLog from './FlightLog'
import { setState, useStore } from '../lib/store'
import { retrySync, useSyncStatus } from '../lib/sync'

const chip = 'rounded-full px-3 py-1 text-[12px] font-medium'

/** Sync state, hidden when all is saved. Never shown without Cognito (the status then stays 'synced'). */
function SyncChip() {
  const { state, pending, lastError } = useSyncStatus()
  return (
    <div aria-live="polite">
      {state === 'syncing' && <span className={`${chip} bg-sage/15 text-ink-2`}>Syncing…</span>}
      {state === 'offline' && <span className={`${chip} bg-ink/10 text-ink-2`}>{pending ? `Offline, ${pending} waiting` : 'Offline'}</span>}
      {state === 'error' && (
        <button type="button" title={lastError} aria-label={`Sync problem. ${lastError ?? ''} Tap to retry`} onClick={() => void retrySync()} className={`${chip} bg-[#8e4d31]/15 text-[#8e4d31]`}>
          Sync problem. Tap to retry
        </button>
      )}
    </div>
  )
}

export default function Header({ title, back, hand, extra }: { title?: string; back?: string; hand?: string; extra?: ReactNode }) {
  const soundOn = useStore((s) => s.soundOn)
  return (
    <header className="sticky top-0 z-30 bg-cream/85 shadow-[0_2px_12px_rgba(62,58,54,0.04)] backdrop-blur-[12px]">
      <div className="flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          {back && (
            <Link to={back} aria-label="Back" className="-ml-2 flex size-10 items-center justify-center rounded-full text-ink">
              <img src="/assets/ic-nav-arrow.svg" alt="" className="size-4 -rotate-90" />
            </Link>
          )}
          <img src="/assets/logo.jpg" alt="" className="size-8" />
          {hand ? (
            <span className="flex flex-col">
              <span className="font-serif text-[20px] font-semibold leading-[22px] tracking-[-0.5px] text-ink">Pigeon Post</span>
              <span className="font-hand text-[20px] font-medium leading-[18px] tracking-[0.6px] text-[#8e4d31]">{hand}</span>
            </span>
          ) : (
            <span className="font-serif text-[20px] font-semibold leading-7 tracking-[-0.5px] text-ink">Pigeon Post</span>
          )}
          {title && (
            <>
              <span className="text-[14px] font-medium text-ink-2">/</span>
              <span className="font-serif text-[20px] font-semibold leading-7 text-sage">{title}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <SyncChip />
          <FlightLog />
          <button
            type="button"
            aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
            aria-pressed={soundOn}
            onClick={() => setState({ soundOn: !soundOn })}
            className="flex size-11 items-center justify-center rounded-full"
          >
            <img src="/assets/ic-sound.svg" alt="" className={`h-4 w-[16.5px] ${soundOn ? '' : 'opacity-35'}`} />
          </button>
          {extra}
          <Link to="/settings/profile" aria-label="Profile and settings" className="flex size-11 items-center justify-center rounded-full">
            <Avatar className="size-8 shadow-[0_1px_4px_rgba(0,0,0,0.08)]" />
          </Link>
        </div>
      </div>
    </header>
  )
}
