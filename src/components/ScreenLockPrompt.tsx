import { PrimaryButton } from './ui'

/**
 * Explains, before Chrome shows its own permission prompt, why Fost wants to know when the screen is locked.
 * Chrome only allows that prompt from a click, so "Allow" runs `onAllow` (which calls IdleDetector.requestPermission).
 */
export default function ScreenLockPrompt({ onAllow, onSkip }: { onAllow: () => void; onSkip: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="lock-title" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-[0_8px_24px_rgba(62,58,54,0.2)]">
        <h2 id="lock-title" className="font-serif text-[22px] font-semibold text-ink">Keep flying when you lock your screen</h2>
        <p className="pt-2 text-[14px] text-ink-2">
          Fost can tell a locked screen from switching to another app. Your bird keeps flying while the screen is locked, and lands if you open something else.
        </p>
        <p className="pt-2 text-[13px] text-muted">Chrome will ask once. Fost never sees what you do, only whether the screen is locked.</p>
        <PrimaryButton onClick={onAllow} className="mt-4">
          Allow
        </PrimaryButton>
        <button type="button" onClick={onSkip} className="mt-2 w-full py-2 text-[13px] font-semibold text-muted">
          Not now
        </button>
      </div>
    </div>
  )
}
