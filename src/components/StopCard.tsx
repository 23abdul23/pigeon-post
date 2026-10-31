import { useState } from 'react'
import type { Story } from '../lib/store'
import StoryDetails, { extrasHas } from './StoryDetails'
import Flag from './Flag'
import Stamp from './Stamp'
import { PrimaryButton, Pill } from './ui'

/** The reward for a finished slot (`queued` cards wait, this one first): a bottom sheet over the live map. It never starts or pauses the flight; "Got it" just dismisses. */
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'nearby', label: 'Nearby' },
  { id: 'wildlife', label: 'Wildlife' },
  { id: 'people', label: 'People & culture' },
] as const

export default function StopCard({ story, newStampCc, covered, queued, onDone, inline = false }: { story: Story; newStampCc?: string; covered?: { cc: string; country: string }[]; queued: number; onDone: () => void; /** fills its container (the popup) instead of being a bottom sheet over the map */ inline?: boolean }) {
  const has = extrasHas(story.extras)
  const tabs = TABS.filter((t) => t.id === 'overview' || has[t.id])
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('overview')
  const active = tabs.some((t) => t.id === tab) ? tab : 'overview'
  const move = (e: React.KeyboardEvent<HTMLElement>, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = tabs[(i + d + tabs.length) % tabs.length]
    setTab(next.id)
    e.currentTarget.ownerDocument.getElementById(`stop-tab-${next.id}`)?.focus() // the popup has its own document
  }
  return (
    <div role="dialog" aria-label={`Stop: ${story.place}`} className={inline ? 'flex h-full min-h-0 p-3' : 'pointer-events-none absolute inset-x-0 bottom-0 z-[5] flex p-4'}>
      <div className={`relative flex w-full flex-col rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(62,58,54,0.2)] ${inline ? 'h-full' : 'pointer-events-auto max-h-[46dvh]'}`}>
        <div className="flex shrink-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate font-serif text-[22px] font-semibold leading-7 text-ink">{story.place}</h2>
            <p className="truncate text-[13px] text-ink-2">{[story.region, story.country].filter(Boolean).join(', ')}</p>
          </div>
          <Pill tone="sky">{story.lens}</Pill>
        </div>
        {tabs.length > 1 && (
          <div role="tablist" aria-label="Stop details" className="-mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 pt-2">
            {tabs.map((t, i) => (
              <button
                key={t.id}
                id={`stop-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={active === t.id}
                aria-controls="stop-panel"
                tabIndex={active === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => move(e, i)}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-semibold ${active === t.id ? 'bg-sage text-white' : 'bg-card text-ink-2'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div role="tabpanel" id="stop-panel" aria-labelledby={`stop-tab-${active}`} className="min-h-0 flex-1 overflow-y-auto pt-3">
        {active !== 'overview' ? (
          <StoryDetails extras={story.extras} only={active} />
        ) : (
        <>
        <div className="relative h-24 shrink-0 overflow-hidden rounded-xl bg-card-soft">
          <img src={story.photo ?? '/assets/terrain-underlayer.jpg'} alt={story.photo ? story.place : ''} className="absolute inset-0 size-full object-cover" />
          {newStampCc && (
            <span className="absolute -bottom-6 right-1 origin-bottom-right scale-[0.55]">
              <Stamp cc={newStampCc} country={story.country} place={story.place} dateMs={story.dateMs} />
            </span>
          )}
        </div>
        <p className="line-clamp-3 pt-2 text-[14px] leading-5 text-ink-2">{story.text}</p>
        {story.birds.length > 0 && <p className="pt-2 text-[12px] font-medium text-sage">Birds here: {story.birds.join(', ')}</p>}
        {covered && covered.length > 0 && (
          <div className="pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.6px] text-muted">Countries this leg</p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
              {covered.map((c) => (
                <li key={c.cc} className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
                  <Flag cc={c.cc} className="!h-3 !w-4" />
                  {c.country}
                </li>
              ))}
            </ul>
          </div>
        )}
        </>
        )}
        </div>
        <PrimaryButton onClick={onDone} className="mt-3 shrink-0 py-2.5">
          {queued > 1 ? 'Next card' : 'Got it'}
        </PrimaryButton>
        {queued > 1 && <p className="pt-2 text-center text-[12px] font-medium text-muted">1 of {queued}</p>}
      </div>
    </div>
  )
}
