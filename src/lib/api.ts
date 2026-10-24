import { getIdToken } from './auth'

const BASE = import.meta.env.VITE_API_URL as string | undefined

export class ApiError extends Error {
  status: number
  /** the parsed JSON error body, when there was one (e.g. 409 `{ flight }` from `PUT /flight`) */
  body?: unknown
  constructor(status: number, message = `HTTP ${status}`, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

/** No answer in time. Not an ApiError, so the outbox retries it like any network error. */
export class ApiTimeout extends Error {
  name = 'TimeoutError'
  constructor(path: string) {
    super(`${path.split('?')[0]} timed out`)
  }
}

/** A request cancelled through its `AbortSignal` (fetch rejects with the signal's reason, a DOMException named AbortError). */
export const isAbortError = (e: unknown) => (e as Error | null)?.name === 'AbortError'

export const API_TIMEOUT_MS = 15_000

/**
 * Calls the Pigeon Post API with the Cognito ID token. Throws ApiError on an HTTP error or when signed out, ApiTimeout after
 * `timeoutMs` without a full answer; network errors and the caller's aborts (`init.signal`) propagate as-is.
 */
export async function api<T>(path: string, init: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<T> {
  const token = await getIdToken()
  if (!token || !BASE) throw new ApiError(401, 'not signed in')
  // a plain controller instead of AbortSignal.any/timeout, which older Safari lacks
  const ctrl = new AbortController()
  const caller = init.signal
  const onAbort = () => ctrl.abort(caller!.reason)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, timeoutMs)
  try {
    if (caller?.aborted) onAbort()
    caller?.addEventListener('abort', onAbort)
    const res = await fetch(BASE + path, {
      ...init,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new ApiError(res.status, undefined, await res.json().catch(() => undefined))
    return (res.status === 204 ? undefined : await res.json()) as T
  } catch (e) {
    throw timedOut && !caller?.aborted ? new ApiTimeout(path) : e
  } finally {
    clearTimeout(timer)
    caller?.removeEventListener('abort', onAbort)
  }
}
