import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import BottomNav from './BottomNav'
import Header from './Header'

/** Desktop-only footer shared by every screen. */
function Footer() {
  return (
    <footer className="mt-auto hidden w-full bg-card-soft py-5 drop-shadow-[0_1px_4px_rgba(0,0,0,0.03)] lg:block">
      <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <img src="/assets/logo.png" alt="" className="h-5 w-auto" />
          <span className="font-serif text-[20px] font-bold leading-7 text-ink">Pigeon Post</span>
          <span className="-rotate-2 pl-2 font-hand text-[22px] leading-7 text-[#8e4d31]">Safe travels to every letter ~</span>
        </div>
        <nav aria-label="Footer" className="flex gap-6 text-[14px] leading-5 text-ink-2">
          <Link to="/settings/profile">Quiet Hours</Link>
          <Link to="/journal">Postal Dispatch Archive</Link>
          <Link to="/settings/profile">Privacy &amp; Papercraft</Link>
        </nav>
        <span className="text-[14px] leading-5 text-ink-2">© 2025 Pigeon Post Dispatch Service. Hand-folded with care.</span>
      </div>
    </footer>
  )
}

export function Frame({ children, nav = false, footer = true }: { children: ReactNode; nav?: boolean; footer?: boolean }) {
  return (
    <div className="desktop-main relative mx-auto flex min-h-screen w-full max-w-[448px] flex-col bg-cream lg:max-w-none">
      {children}
      {nav && <BottomNav />}
      {footer && <Footer />}
    </div>
  )
}

export function AppLayout({ children, title, back, hand, nav = true }: { children: ReactNode; title?: string; back?: string; hand?: string; nav?: boolean }) {
  return (
    <Frame>
      <Header title={title} back={back} hand={hand} />
      <main className="mx-auto w-full flex-1 px-4 pb-6 pt-1 lg:max-w-[1440px] lg:px-6 lg:pt-0">{children}</main>
      {nav && <BottomNav />}
    </Frame>
  )
}
