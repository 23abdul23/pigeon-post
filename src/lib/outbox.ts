import { api, ApiError } from './api'
import { COGNITO_CONFIGURED, currentSub, getUserSub } from './auth'
import { getState } from './store'
import { getSyncStatus, markSynced, setSyncStatus } from './syncStatus'

/** `touches` names the entities the write changes (see `pendingTouches`); a refresh never overwrites what is pending. */
export type Op = { id: string; method: string; path: string; body?: unknown; touches: string[] }
type Queued = Op & { owner?: string }

const KEY = 'pigeon-post:outbox'
const MAX_BACKOFF_MS = 60_000

let queue: Queued[] | undefined
function q(): Queued[] {
  if (!queue) {
    try {
      queue = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Queued[]
    } catch {
      queue = []
    }
  }
  return queue
}
function save(next: Queued[]) {
  queue = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // storage unavailable: keep the queue in memory
  }
}

/** Queues a write for the signed-in user; an op with the same id replaces the queued one (each op is a full PUT-style write). */
export function enqueue(op: Op): void {
  // Local data owned by another account (or by an unconfirmed one) is never queued for the current user's token.
  const owner = getState().ownerSub
  if (COGNITO_CONFIGURED && owner !== null && owner !== (currentSub() ?? null)) return void console.warn('outbox: write refused, local data belongs to another account')
  note(op.touches)
  save([...q().filter((o) => o.id !== op.id), { ...op, owner: currentSub() ?? undefined }])
  if (getSyncStatus().state !== 'synced') setSyncStatus({ pending: pendingOps() })
}

export const GROUPS = ['profile', 'trip', 'stories', 'stamps', 'sessions', 'friends', 'letters']

/** Every `send` from the moment it is called (waiting its turn on the chain or in flight) until the server answered. */
const active = new Set<Op>()
/** Queued writes plus any `send` the server has not answered yet: until then, `GET /state` may not reflect them. */
export const pendingOps = () => q().length + [...active].filter((o) => !q().some((x) => x.id === o.id)).length

// A monotonic log of write starts and settlements, so a refresh can tell that a write finished while its fetch was out.
let seq = 0
let log: { seq: number; touches: string[] }[] = []
const note = (touches: string[] | undefined) => {
  log = [...log.slice(-199), { seq: ++seq, touches: touches ?? GROUPS }]
}
export const writeSeq = () => seq
const expand = (out: Set<string>, touches: string[] | undefined) => {
  for (const t of touches ?? GROUPS) {
    out.add(t)
    if (t.startsWith('story:')) out.add('stories')
    if (t.startsWith('letter:')) out.add('letters')
  }
}
/** Entities touched by any write that started or settled after `since` (a `writeSeq()` value). */
export function touchedSince(since: number): Set<string> {
  const out = new Set<string>()
  for (const e of log) if (e.seq > since) expand(out, e.touches)
  return out
}

let onFlushed: (() => void) | undefined
/** Registered by sync.ts (avoids an import cycle): called after a flush that sent something and left nothing pending. */
export const setOnFlushed = (fn: () => void) => void (onFlushed = fn)

let onRejected: ((op: Op, e: ApiError) => boolean) | undefined
/** Registered by flight.ts: sees a queued op the server refused for good; true when it handled it (no error shown). */
export const setOnRejected = (fn: (op: Op, e: ApiError) => boolean) => void (onRejected = fn)

/**
 * The entities a refresh must not overwrite because a local write to them is queued or still in flight. Entity groups:
 * profile, trip, stories, stamps, sessions, friends, letters. A touch is a group name, or `story:<id>` / `letter:<id>`,
 * which also protects its parent group (`stories` / `letters`): the poll replaces whole lists, so one unsent item
 * would otherwise be lost with them. Every other group keeps taking server state.
 */
export function pendingTouches(): Set<string> {
  const out = new Set<string>()
  for (const o of [...q(), ...active]) expand(out, o.touches) // persisted ops from older builds have no touches: assume all
  return out
}

const what = (id: string) =>
  id === 'me' ? 'your profile'
    : id.startsWith('friend-') ? 'a friend change'
    : id.startsWith('letter') ? 'a letter'
    : id.startsWith('story') ? 'a story'
    : id.startsWith('session') || id.startsWith('flight') ? 'your flight'
    : id.startsWith('return') ? 'your return flight'
    : id.startsWith('trip') ? 'your trip'
    : 'a change'
const dropMessage = (op: Op, e: unknown) => `Could not save ${what(op.id)}: ${e instanceof Error ? e.message : 'rejected'}`

/** On sign-out: queued ops belong to this user and must not be sent with the next user's token. */
export const clearOutbox = () => {
  save([])
  setSyncStatus({ state: 'synced', pending: 0, lastError: undefined })
}

// A 4xx means the server will never accept this op; 401 (token refresh) and 429 (throttled) can succeed later.
const permanent = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429

let running: Promise<void> | undefined
let attempt = 0
let timer: ReturnType<typeof setTimeout> | undefined

/** Sends queued ops in order. On a network error or 5xx it stops and retries later with backoff; on a 4xx the op is dropped. */
export function flush(): Promise<void> {
  return (running ??= run().finally(() => (running = undefined)))
}

async function run() {
  clearTimeout(timer)
  // Never send one user's queued writes with another user's token (e.g. A's session lapsed, B signed in).
  const sub = await getUserSub().catch(() => null)
  if (sub) save(q().filter((o) => o.owner === sub))
  let dropped: string | undefined
  let sent = 0
  if (q().length) setSyncStatus({ state: 'syncing', pending: q().length, lastError: undefined })
  while (q().length) {
    const op = q()[0]
    try {
      await api(op.path, { method: op.method, ...(op.body === undefined ? {} : { body: JSON.stringify(op.body) }) })
      sent++
    } catch (e) {
      if (!permanent(e)) {
        timer = setTimeout(() => void flush(), Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++))
        setSyncStatus({ state: 'offline', pending: pendingOps() })
        return
      }
      console.warn('outbox: server rejected op, dropping it', op, e)
      if (!onRejected?.(op, e as ApiError)) dropped = dropMessage(op, e)
    }
    attempt = 0
    save(q().filter((o) => o !== op)) // by identity: a newer op with the same id, queued meanwhile, stays
    note(op.touches)
  }
  if (dropped) setSyncStatus({ state: 'error', pending: pendingOps(), lastError: dropped })
  else if (getSyncStatus().state === 'syncing' && !pendingOps()) markSynced()
  if (sent && !dropped && !pendingOps()) onFlushed?.()
}

let chain: Promise<unknown> = Promise.resolve()

/**
 * Sends a write now and returns the server's reply, or null when it was queued instead (offline, error, or older
 * writes still queued, which must go first). Calls run one at a time so writes reach the server in the order made.
 * `rejected` sees a permanent 4xx of the direct call (with its body) and returns true when it handled it, so no error
 * is shown. Without Cognito (offline dev) nothing is sent.
 */
export function send<T>(op: Op, rejected?: (e: ApiError) => boolean): Promise<T | null> {
  if (!COGNITO_CONFIGURED) return Promise.resolve(null)
  note(op.touches)
  active.add(op)
  const p = chain.then(async () => {
    let ok = false
    try {
      if (!q().length) {
        try {
          const r = await api<T>(op.path, { method: op.method, ...(op.body === undefined ? {} : { body: JSON.stringify(op.body) }) })
          ok = true
          return r
        } catch (e) {
          console.warn(permanent(e) ? 'server rejected op' : 'send failed; queued for retry', op, e)
          if (permanent(e)) {
            if (!rejected?.(e as ApiError)) setSyncStatus({ state: 'error', pending: pendingOps(), lastError: dropMessage(op, e) })
            return null
          }
        }
      }
      enqueue(op)
      void flush()
      return null
    } finally {
      active.delete(op)
      note(op.touches)
      if (ok && ['syncing', 'offline'].includes(getSyncStatus().state) && !pendingOps()) markSynced()
    }
  })
  chain = p.catch(() => null)
  return p
}
