import { getState } from './store'

const KEY = 'pigeon-post:device'
let id: string | undefined

/** This browser's id for flight ownership (`PUT /flight`): a random UUID kept in localStorage. */
export function deviceId(): string {
  if (id) return id
  try {
    id = localStorage.getItem(KEY) ?? undefined
  } catch {
    // storage unavailable: an in-memory id for this page load
  }
  if (!id) {
    id = crypto.randomUUID()
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // ignore
    }
  }
  return id
}

/** The server's clock, from the offset measured at the last `GET /state`; every flight time uses it so devices agree. */
export const serverNow = () => Date.now() + getState().clockOffsetMs
