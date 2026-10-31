import { NavLink } from 'react-router-dom'
import { useStore } from '../lib/store'

const items = [
  { to: '/home', label: 'Home', icon: '/assets/nav-home-active.svg', activeIcon: '/assets/nav-home-active.svg' },
  { to: '/mailbox', label: 'Mail', icon: '/assets/nav-mail.svg', activeIcon: '/assets/nav-mail.svg', badge: 0 },
  { to: '/friends', label: 'Friends', icon: '/assets/nav-friends.svg', activeIcon: '/assets/nav-friends.svg' },
  { to: '/passport', label: 'Passport', icon: '/assets/nav-passport.svg', activeIcon: '/assets/nav-passport.svg' },
  { to: '/journal', label: 'Journal', icon: '/assets/nav-journal.svg', activeIcon: '/assets/nav-journal.svg' },
]

export default function BottomNav() {
  const unopened = useStore((s) => s.letters.filter((l) => l.toId === 'me' && l.status === 'DELIVERED').length)
  return (
    <nav aria-label="Main" className="sticky bottom-0 z-30 px-5 pb-4 lg:hidden">
      <div className="flex h-16 items-center rounded-full bg-white/90 px-1 shadow-[0_8px_24px_-4px_rgba(62,58,54,0.08),0_2px_6px_-1px_rgba(62,58,54,0.04)] backdrop-blur-[12px]">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) =>
              `relative flex size-12 flex-1 flex-col items-center justify-center rounded-full ${isActive ? 'bg-[#7fa38a]' : ''}`
            }
          >
            {({ isActive }) => (
              <>
                <img src={it.icon} alt="" className="h-[18px] w-auto" />
                <span className={`text-[10px] ${isActive ? 'font-semibold text-[#183926]' : 'text-ink-2'}`}>{it.label}</span>
                {(it.to === '/mailbox' ? unopened : 0) ? (
                  <span className="absolute right-2 top-1 flex size-4 items-center justify-center rounded-full bg-[#8e4d31] text-[10px] text-white">
                    {unopened}
                  </span>
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
