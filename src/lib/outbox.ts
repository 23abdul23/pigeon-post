import { api, ApiError } from './api'
import { currentSub, getUserSub } from './auth'

export type Op = { id: string; method: string; path: string; body?: unknown }
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
  save([...q().filter((o) => o.id !== op.id), { ...op, owner: currentSub() ?? undefined }])
}

export const pendingOps = () => q().length

/** On sign-out: queued ops belong to this user and must not be sent with the next user's token. */
export const clearOutbox = () => save([])

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
  const sub = await getUserSub()
  if (sub) save(q().filter((o) => o.owner === sub))
  while (q().length) {
    const op = q()[0]
    try {
      await api(op.path, { method: op.method, ...(op.body === undefined ? {} : { body: JSON.stringify(op.body) }) })
    } catch (e) {
      if (!permanent(e)) {
        timer = setTimeout(() => void flush(), Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++))
        return
      }
      console.warn('outbox: server rejected op, dropping it', op, e)
    }
    attempt = 0
    save(q().filter((o) => o !== op)) // by identity: a newer op with the same id, queued meanwhile, stays
  }
}
