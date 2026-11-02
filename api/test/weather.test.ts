import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { handler } from '../src/handlers/weather'

const UPSTREAM = { current: { temperature_2m: 12.3, wind_speed_10m: 17.5, wind_direction_10m: 250 } }
let reply: () => Response
const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => reply())
const urls = () => fetchMock.mock.calls.map((c) => new URL(String(c[0])))
const ok = () => new Response(JSON.stringify(UPSTREAM), { status: 200, headers: { 'content-type': 'application/json' } })

const ev = (qs: Record<string, string> | undefined) =>
  ({
    routeKey: 'GET /weather',
    queryStringParameters: qs,
    headers: {},
    requestContext: { http: { sourceIp: '203.0.113.9' }, authorizer: { jwt: { claims: { sub: 'u1' }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
const call = async (qs: Record<string, string> | undefined) => {
  const r = (await handler(ev(qs))) as APIGatewayProxyStructuredResultV2
  return { status: r.statusCode, body: JSON.parse(r.body!) }
}

beforeEach(() => {
  reply = ok
  fetchMock.mockClear()
  delete process.env.OPEN_METEO_API_KEY
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /weather', () => {
  it('weather_rejects_missing_or_out_of_range_coordinates_400', async () => {
    for (const qs of [undefined, {} as Record<string, string>, { lat: '10' }, { lng: '10' }, { lat: '91', lng: '0' }, { lat: '-91', lng: '0' }, { lat: '0', lng: '180.5' }, { lat: '0', lng: '-181' }, { lat: 'abc', lng: '0' }, { lat: 'NaN', lng: '0' }, { lat: 'Infinity', lng: '0' }, { lat: '', lng: '0' }]) {
      expect((await call(qs)).status, JSON.stringify(qs)).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('weather_rounds_coordinates_so_nearby_requests_share_a_cache_entry', async () => {
    const a = await call({ lat: '48.8566', lng: '2.3522' })
    expect(a).toEqual({ status: 200, body: { speedKmh: 17.5, fromDeg: 250, tempC: 12.3 } })
    const b = await call({ lat: '48.9049', lng: '2.3501' })
    expect(b.body).toEqual(a.body)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const u = urls()[0]
    expect(u.host).toBe('api.open-meteo.com')
    expect(u.searchParams.get('latitude')).toBe('48.9')
    expect(u.searchParams.get('longitude')).toBe('2.4')
    expect(u.searchParams.get('current')).toBe('temperature_2m,wind_speed_10m,wind_direction_10m')
    expect(u.searchParams.has('apikey')).toBe(false)
    await call({ lat: '48.7', lng: '2.4' }) // another cell
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('weather_cache_expires_after_ten_minutes', async () => {
    vi.useFakeTimers()
    try {
      await call({ lat: '-33.9', lng: '151.2' })
      vi.advanceTimersByTime(9 * 60_000)
      await call({ lat: '-33.9', lng: '151.2' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(2 * 60_000)
      await call({ lat: '-33.9', lng: '151.2' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('weather_uses_api_key_when_configured', async () => {
    process.env.OPEN_METEO_API_KEY = 'test-key-123'
    const r = await call({ lat: '35.7', lng: '139.7' })
    expect(r.status).toBe(200)
    const u = urls()[0]
    expect(u.host).toBe('customer-api.open-meteo.com')
    expect(u.pathname).toBe('/v1/forecast')
    expect(u.searchParams.get('apikey')).toBe('test-key-123')
  })

  it('weather_upstream_failure_returns_502_not_500', async () => {
    process.env.OPEN_METEO_API_KEY = 'secret-key-xyz'
    const log = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')].map((s) => s.mockImplementation(() => {}))
    const failures: Array<() => Response> = [
      () => new Response('nope', { status: 500 }),
      () => new Response('limit', { status: 429 }),
      () => { throw new DOMException('timed out', 'TimeoutError') },
      () => new Response('{"current":{}}', { status: 200 }),
      () => new Response('not json', { status: 200 }),
    ]
    let lng = 10
    for (const f of failures) {
      reply = f
      const r = await call({ lat: '1', lng: String((lng += 1)) })
      expect(r.status).toBe(502)
      expect(JSON.stringify(r.body)).not.toMatch(/secret-key-xyz|open-meteo|apikey/)
    }
    const logged = JSON.stringify(log.flatMap((s) => s.mock.calls))
    expect(logged).not.toMatch(/secret-key-xyz|apikey/)
    // a failure is not cached
    reply = ok
    expect((await call({ lat: '1', lng: '11' })).status).toBe(200)
    vi.restoreAllMocks()
  })
})
