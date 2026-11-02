import { useState, type ReactNode } from 'react'
import { blockUser, reportContent } from '../lib/safety'
import { S } from '../lib/strings'
import type { ReportInput } from '../lib/types'

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="flex w-full max-w-[400px] flex-col gap-3 rounded-2xl bg-white p-5 shadow-[0_12px_32px_-6px_rgba(62,58,54,0.3)]">
        <h2 className="font-serif text-[20px] font-semibold leading-7 text-ink">{title}</h2>
        {children}
      </div>
    </div>
  )
}

const cancelCls = 'rounded-full bg-line px-5 py-2 text-[14px] font-bold text-ink-2'
const primaryCls = 'rounded-full bg-[#8e4d31] px-5 py-2 text-[14px] font-bold text-white disabled:opacity-50'

/** Asks before blocking; the block is optimistic (see `blockUser`). */
export function BlockDialog({ id, name, onClose, onDone }: { id: string; name: string; onClose: () => void; onDone?: () => void }) {
  return (
    <Modal title={S.blockTitle(name)} onClose={onClose}>
      <p className="text-[14px] leading-5 text-ink-2">{S.blockBody(name)}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={cancelCls}>{S.cancel}</button>
        <button
          type="button"
          onClick={() => {
            void blockUser(id)
            onClose()
            onDone?.()
          }}
          className={primaryCls}
        >
          {S.blockConfirm}
        </button>
      </div>
    </Modal>
  )
}

type Target = { targetId: string; kind: ReportInput['kind']; letterId?: string }

/** Pick a reason, add an optional note, send. A failed send is queued by the outbox, so the user is never asked to retry. */
export function ReportDialog({ target, title, onClose }: { target: Target; title: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportInput['reason'] | null>(null)
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  const reasons = Object.keys(S.reasons) as ReportInput['reason'][]

  async function submit() {
    if (!reason) return
    const trimmed = [...note.trim()].slice(0, S.reportNoteMax).join('')
    setSent(true)
    await reportContent({ ...target, reason, ...(trimmed ? { note: trimmed } : {}) })
  }

  return (
    <Modal title={title} onClose={onClose}>
      {sent ? (
        <>
          <p className="text-[14px] leading-5 text-ink-2">{S.reportSent}</p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={primaryCls}>OK</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[14px] leading-5 text-ink-2">{S.reportBody}</p>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="pb-1 text-[12px] font-bold uppercase tracking-[0.6px] text-ink-2">{S.reportReasonLabel}</legend>
            {reasons.map((r) => (
              <label key={r} className="flex items-center gap-2 text-[14px] text-ink">
                <input type="radio" name="report-reason" checked={reason === r} onChange={() => setReason(r)} />
                {S.reasons[r]}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-[12px] text-ink-2">
            {S.reportNoteLabel}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={S.reportNoteMax} rows={3} className="rounded-xl bg-card-soft p-2 text-[14px] text-ink outline-none focus:ring-2 focus:ring-sage/40" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={cancelCls}>{S.cancel}</button>
            <button type="button" onClick={() => void submit()} disabled={!reason} className={primaryCls}>{S.reportSend}</button>
          </div>
        </>
      )}
    </Modal>
  )
}
