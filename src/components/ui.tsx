import type { ReactNode } from 'react'

export const shadowSm = 'shadow-[0_1px_1px_rgba(0,0,0,0.05)]'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[20px] bg-card ${shadowSm} ${className}`}>{children}</section>
}

export function Pill({ children, tone = 'sky', className = '' }: { children: ReactNode; tone?: 'sky' | 'sage' | 'sand'; className?: string }) {
  const tones = { sky: 'bg-sky text-[#4d6876]', sage: 'bg-[#c6ecce] text-[#2d4e39]', sand: 'bg-line text-ink-2' }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px] ${tones[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function PrimaryButton({ children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`flex mx-auto w-fit px-8 items-center justify-center gap-2 rounded-full bg-[#d58767] py-3.5 text-[14px] font-bold uppercase tracking-[0.35px] text-white ${shadowSm} disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}

export function SoftButton({ children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`flex mx-auto w-fit px-8 items-center justify-center gap-2 rounded-full bg-card-soft py-2.5 text-[14px] font-bold tracking-[0.28px] text-sage disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}

export function Hand({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-hand text-[22px] font-medium leading-7 ${className}`}>{children}</span>
}
