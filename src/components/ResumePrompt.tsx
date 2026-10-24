import { PrimaryButton } from './ui'

/** Shown when the user returns to a flight that froze while they were away. */
export default function ResumePrompt({ onContinue, onLand }: { onContinue: () => void; onLand: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Continue your journey" className="absolute inset-0 z-20 flex items-center justify-center bg-ink/30 p-6">
      <div className="w-full rounded-2xl bg-white p-5 text-center shadow-[0_8px_24px_rgba(62,58,54,0.2)]">
        <h2 className="font-serif text-[22px] font-semibold text-ink">Let's continue your journey</h2>
        <p className="pt-1 text-[14px] text-ink-2">Your bird waited for you where you left off.</p>
        <PrimaryButton onClick={onContinue} className="mt-4">
          Continue
        </PrimaryButton>
        <button type="button" onClick={onLand} className="mt-2 w-full py-2 text-[13px] font-semibold text-muted">
          Land here
        </button>
      </div>
    </div>
  )
}
