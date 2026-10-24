import type { Story } from '../lib/store'
import Flag from './Flag'
import Stamp from './Stamp'
import { PrimaryButton, Pill } from './ui'

/** The reward for a finished slot, shown over the map instead of navigating away. */
export default function StopCard({ story, newStampCc, covered, stopsLeft, onContinue, onFinish }: { story: Story; newStampCc?: string; covered?: { cc: string; country: string }[]; stopsLeft: number; onContinue: () => void; onFinish: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={`Stop: ${story.place}`} className="absolute inset-0 z-20 flex items-end bg-ink/30 p-4">
      <div className="relative max-h-full w-full overflow-y-auto rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(62,58,54,0.2)]">
        <div className="relative h-36 overflow-hidden rounded-xl bg-card-soft">
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
        <p className="line-clamp-5 pt-2 text-[14px] leading-5 text-ink-2">{story.text}</p>
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
        <PrimaryButton onClick={onContinue} className="mt-4 flex-col gap-0 py-2.5">
          <span>Continue journey</span>
          <span className="text-[11px] font-medium normal-case tracking-normal opacity-90">
            {stopsLeft} stop{stopsLeft === 1 ? '' : 's'} to go
          </span>
        </PrimaryButton>
        <button type="button" onClick={onFinish} className="mt-2 w-full py-2 text-[13px] font-semibold text-muted">
          Land here
        </button>
      </div>
    </div>
  )
}
