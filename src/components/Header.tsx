import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
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

const TABS = [
  { to: '/home', label: 'Home' },
  { to: '/mailbox', label: 'Mailbox' },
  { to: '/friends', label: 'Friends' },
  { to: '/passport', label: 'Passport' },
  { to: '/journal', label: 'Journal' },
]

/** Desktop (lg+) top bar: logo, tab pill, sound and profile. */
export function DesktopBar({ extra, hideLog }: { extra?: ReactNode; hideLog?: boolean }) {
  const soundOn = useStore((s) => s.soundOn)
  const user = useStore((s) => s.user)
  const unopened = useStore((s) => s.letters.filter((l) => l.toId === 'me' && l.status === 'DELIVERED').length)
  return (
    <div className="sticky top-0 z-30 hidden bg-cream/85 shadow-[0_2px_12px_rgba(62,58,54,0.04)] backdrop-blur-[12px] lg:block">
    <div className="mx-auto flex h-[80px] w-full max-w-[1440px] items-center justify-between px-6">
      <div className="flex items-center gap-8">
        <Link to="/home" className="flex items-center gap-2">
          <img src="/assets/logo.png" alt="" className="h-[23px] w-auto" />
          <span className="font-serif text-[24px] font-bold leading-8 tracking-[-0.6px] text-ink">Pigeon Post</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 rounded-full bg-card p-1">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-full px-4 py-1 font-serif text-[14px] font-bold leading-5 tracking-[0.28px] ${isActive ? 'bg-[#7fa38a] text-[#183926]' : 'text-ink-2 hover:text-ink'}`
              }
            >
              {t.label}
              {t.to === '/mailbox' && unopened > 0 && (
                <span className="flex size-5 items-center justify-center rounded-full bg-[#8e4d31] text-[12px] leading-4 tracking-[0.36px] text-white">{unopened}</span>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <SyncChip />
        {!hideLog && <FlightLog />}
        <button
          type="button"
          aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
          aria-pressed={soundOn}
          onClick={() => setState({ soundOn: !soundOn })}
          className="flex size-11 items-center justify-center rounded-full bg-card"
        >
          <img src="/assets/ic-sound.svg" alt="" className={`h-4 w-[16.5px] ${soundOn ? '' : 'opacity-35'}`} />
        </button>
        {extra}
        <Link to="/settings/profile" aria-label="Profile and settings" className="flex items-center gap-2 rounded-full bg-card-soft py-1 pl-2 pr-4">
          <Avatar className="size-8" />
          <span className="flex flex-col pr-1">
            <span className="font-serif text-[14px] font-bold leading-[17.5px] tracking-[0.28px] text-ink">{user?.name ?? 'Traveler'}</span>
            <span className="font-serif text-[12px] font-bold leading-[15px] tracking-[0.36px] text-ink-2">Postmaster</span>
          </span>
          <img src="/assets/ic-angle-down.svg" alt="" className="w-[9px]" />
        </Link>
      </div>
    </div>
    </div>
  )
}

export default function Header({ title, back, hand, extra, hideLog }: { title?: string; back?: string; hand?: string; extra?: ReactNode; hideLog?: boolean }) {
  const soundOn = useStore((s) => s.soundOn)
  return (
    <header className="sticky top-0 z-30 bg-cream/85 shadow-[0_2px_12px_rgba(62,58,54,0.04)] backdrop-blur-[12px]">
      <DesktopBar extra={extra} hideLog={hideLog} />
      <div className="flex h-16 items-center justify-between px-4 lg:hidden">
        <div className="flex items-center gap-2">
          {back && (
            <Link to={back} aria-label="Back" className="-ml-2 flex size-10 items-center justify-center rounded-full text-ink">
              <img src="/assets/ic-nav-arrow.svg" alt="" className="size-4 -rotate-90" />
            </Link>
          )}
          <img src="/assets/logo.png" alt="" className="size-8" />
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
          {!hideLog && <FlightLog />}
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
