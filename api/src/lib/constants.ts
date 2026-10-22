/** Server copy of the client's scale constant (src/lib/geo.ts); a test asserts they match. */
export const KM_PER_FOCUS_MINUTE = 100

/** The 7 bird ids in src/lib/birds.ts; a test asserts they match. */
export const BIRD_IDS = ['hawk', 'stork', 'flamingo', 'parrot', 'gull', 'seagull', 'hummingbird'] as const

/** City-level precision only: we never store an exact location. */
export const roundCoord = (n: number): number => Math.round(n * 100) / 100

/** Letters (Global Constraints): text and attachment limits, enforced by the API. */
export const LETTER_MAX_CHARS = 2000
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
export const ATTACHMENT_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'application/pdf']
export const MAX_ATTACHMENTS = 3
