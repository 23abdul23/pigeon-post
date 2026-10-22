import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda'
import { getUserId, Unauthorized } from './auth'

export const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
export const fail = (status: number, msg: string): never => {
  throw new HttpError(status, msg)
}
export const bad = (msg: string): never => fail(400, msg)

type Event = APIGatewayProxyEventV2WithJWTAuthorizer
/** Wraps a handler: resolves the caller's `sub` and turns Unauthorized / HttpError into 401 / their status. */
export const route =
  (fn: (sub: string, event: Event) => Promise<APIGatewayProxyResultV2>) =>
  async (event: Event): Promise<APIGatewayProxyResultV2> => {
    try {
      return await fn(getUserId(event), event)
    } catch (e) {
      if (e instanceof Unauthorized) return json(401, { error: 'unauthorized' })
      if (e instanceof HttpError) return json(e.status, { error: e.message })
      throw e
    }
  }

// Validation helpers for request bodies (trust boundary).
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const str = (v: unknown, max: number, what: string) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : bad(`invalid ${what}`))
export const optStr = (v: unknown, max: number, what: string) => (v === undefined ? undefined : str(v, max, what))
export const num = (v: unknown, min: number, max: number, what: string) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : bad(`invalid ${what}`)
/** Ids end up inside sort keys, so only plain uuid-like strings. */
export const id = (v: unknown, what: string) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : bad(`invalid ${what}`))
export const cc = (v: unknown, what: string) => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : bad(`invalid ${what}`))
export function parseBody(body: string | undefined): Record<string, unknown> {
  let v: unknown
  try {
    v = JSON.parse(body ?? '')
  } catch {
    return bad('invalid JSON')
  }
  return isObj(v) ? v : bad('body must be an object')
}
