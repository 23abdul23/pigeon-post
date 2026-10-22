/** Server copy of the client's scale constant (src/lib/geo.ts); a test asserts they match. */
export const KM_PER_FOCUS_MINUTE = 100

/** The 7 bird ids in src/lib/birds.ts; a test asserts they match. */
export const BIRD_IDS = ['hawk', 'stork', 'flamingo', 'parrot', 'gull', 'seagull', 'hummingbird'] as const

/** City-level precision only: we never store an exact location. */
export const roundCoord = (n: number): number => Math.round(n * 100) / 100
