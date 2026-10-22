import { KM_PER_FOCUS_MINUTE } from './constants'

/** The most distance a session may claim: its wall-clock length at the focus speed, plus 5% slack for clock skew. */
export const clampKm = (claimedKm: number, startMs: number, endMs: number): number =>
  Math.max(0, Math.min(claimedKm, (Math.max(0, endMs - startMs) / 60000) * KM_PER_FOCUS_MINUTE * 1.05))
