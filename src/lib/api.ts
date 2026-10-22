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

/** Calls the Pigeon Post API with the Cognito ID token. Throws ApiError on an HTTP error or when signed out; network errors propagate as-is. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getIdToken()
  if (!token || !BASE) throw new ApiError(401, 'not signed in')
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new ApiError(res.status, undefined, await res.json().catch(() => undefined))
  return (res.status === 204 ? undefined : await res.json()) as T
}
