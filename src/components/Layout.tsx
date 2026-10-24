import type { ReactNode } from 'react'
import BottomNav from './BottomNav'
import Header from './Header'

export function Frame({ children, nav = false }: { children: ReactNode; nav?: boolean }) {
  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-[448px] flex-col bg-cream">
      {children}
      {nav && <BottomNav />}
    </div>
  )
}

export function AppLayout({ children, title, back, hand, nav = true }: { children: ReactNode; title?: string; back?: string; hand?: string; nav?: boolean }) {
  return (
    <Frame>
      <Header title={title} back={back} hand={hand} />
      <main className="flex-1 px-4 pb-6 pt-1">{children}</main>
      {nav && <BottomNav />}
    </Frame>
  )
}
