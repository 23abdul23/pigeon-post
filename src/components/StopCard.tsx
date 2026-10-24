import type { Story } from '../lib/store'
import Flag from './Flag'
import Stamp from './Stamp'
import { PrimaryButton, Pill } from './ui'

/** The reward for a finished slot (`queued` cards wait, this one first): a bottom sheet over the live map. It never starts or pauses the flight; "Got it" just dismisses. */
export default function StopCard({ story, newStampCc, covered, queued, onDone }: { story: Story; newStampCc?: string; covered?: { cc: string; country: string }[]; queued: number; onDone: () => void }) {
  return (
    <div role="dialog" aria-label={`Stop: ${story.place}`} className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] flex p-4">
      <div className="pointer-events-auto relative flex max-h-[46dvh] w-full flex-col rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(62,58,54,0.2)]">
        <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative h-24 shrink-0 overflow-hidden rounded-xl bg-card-soft">
          <img src={story.photo ?? '/assets/terrain-underlayer.jpg'} alt={story.photo ? story.place : ''} className="absolute inset-0 size-full object-cover" />
          {newStampCc && (
            <span className="absolute -bottom-6 right-1 origin-bottom-right scale-[0.55]">
              <Stamp cc={newStampCc} country={story.country} place={story.place} dateMs={story.dateMs} />
            </span>
          )}
        </div>
        <div className="flex items-start justify-between gap-2 pt-3">
          <div className="min-w-0">
            <h2 className="truncate font-serif text-[22px] font-semibold leading-7 text-ink">{story.place}</h2>
            <p className="truncate text-[13px] text-ink-2">{[story.region, story.country].filter(Boolean).join(', ')}</p>
          </div>
          <Pill tone="sky">{story.lens}</Pill>
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
        </div>
        <PrimaryButton onClick={onDone} className="mt-3 shrink-0 py-2.5">
          {queued > 1 ? 'Next card' : 'Got it'}
        </PrimaryButton>
        {queued > 1 && <p className="pt-2 text-center text-[12px] font-medium text-muted">1 of {queued}</p>}
      </div>
    </div>
  )
}
