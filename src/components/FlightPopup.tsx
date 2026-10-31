import type { ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import type { BirdSpecies } from '../lib/birds'
import type { Story } from '../lib/store'
import BirdViewer from './BirdViewer'
import FlightHud from './FlightHud'
import StopCard from './StopCard'

type Hud = Omit<ComponentProps<typeof FlightHud>, 'action'> & { onEnd: () => void; onRest: () => void; resting: boolean }
type Card = { story: Story; newStampCc?: string; covered?: { cc: string; country: string }[]; queued: number; onDone: () => void }

/**
 * The content of the floating Document Picture-in-Picture window, rendered through a portal so it shares the page's store and clock.
 * Without a checkpoint: the flying bird with the flight card under it. With one: the stop card (place first) and a way back to the tab.
 */
export default function FlightPopup({ win, species, turnRef, hud, card, onOpenTab }: { win: Window; species: BirdSpecies; turnRef: { current: number }; hud: Hud; card: Card | null; onOpenTab: () => void }) {
  const { onEnd, onRest, resting, ...hudProps } = hud
  return createPortal(
    <div className="@container flex h-dvh min-h-0 flex-col bg-cream">
      {card ? (
        <>
          <div className="min-h-0 flex-1">
            <StopCard inline {...card} />
          </div>
          <button type="button" onClick={onOpenTab} className="mx-3 mb-3 shrink-0 rounded-full bg-card-soft py-2.5 text-[14px] font-bold text-ink-2">
            Open Pigeon Post
          </button>
        </>
      ) : (
        <>
          <div className="pointer-events-none min-h-0 flex-1">
            <BirdViewer bird={species} flight turnRef={turnRef} className="size-full" />
          </div>
          <div className="m-3 shrink-0 rounded-2xl bg-white/90 p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <FlightHud
              {...hudProps}
              stops={hudProps.stops}
              action={
                <span className="flex items-center gap-1">
                  <button type="button" disabled={resting} onClick={onRest} className="rounded bg-sage px-1.5 py-0.5 text-[12px] font-semibold tracking-[0.36px] text-white disabled:opacity-60">
                    {resting ? 'Resting…' : 'Rest here'}
                  </button>
                  <button type="button" onClick={onEnd} className="rounded bg-[rgba(239,231,225,0.6)] px-1.5 py-0.5 text-[12px] font-semibold tracking-[0.36px] text-[#8e4d31]">
                    End flight
                  </button>
                </span>
              }
            />
          </div>
        </>
      )}
    </div>,
    win.document.body,
  )
}
