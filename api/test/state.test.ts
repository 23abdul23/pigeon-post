import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { FLIGHT_STALE_MS } from '../src/lib/constants'
import { handler as state } from '../src/handlers/state'
import { createTrip } from '../src/handlers/trips'

process.env.TABLE_NAME = 'PigeonPostTest'
const ddb = mockClient(DynamoDBDocumentClient)
const NOW = 1_800_000_000_000

const ev = (body?: unknown) =>
  ({
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub: 'u1' }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
const call = async (h: typeof state, e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = (await h(e)) as APIGatewayProxyStructuredResultV2
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }
}

const pk = { PK: 'USER#u1' }
const home = { name: 'Zagreb', country: 'Croatia', cc: 'HR', lat: 45.81, lng: 15.98 }
const dest = { id: 'p1', name: 'Split', country: 'Croatia', cc: 'HR', lat: 43.5, lng: 16.44 }
const flight = { tripId: 't1', startMs: NOW - 60000, durationMin: 25, baseKm: 0, deviceId: 'phone-device-1', heartbeatMs: NOW }

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  ddb.reset()
})
afterEach(() => vi.useRealTimers())

describe('GET /state', () => {
  it('state_includes_flight_and_server_time', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] })
    expect((await call(state, ev())).body).toMatchObject({ flight: null, serverTime: NOW })

    ddb.on(QueryCommand).resolves({ Items: [{ ...pk, SK: 'FLIGHT', ...flight, ttl: Math.floor(NOW / 1000) + 3600 }] })
    const b = (await call(state, ev())).body
    expect(b.flight).toEqual(flight) // no PK/SK/ttl
    expect(b.serverTime).toBe(NOW)
    expect(b.stories).toEqual([]) // FLIGHT is not mistaken for any other row kind

    // DynamoDB deletes expired items lazily: one past its ttl is already gone
    ddb.on(QueryCommand).resolves({ Items: [{ ...pk, SK: 'FLIGHT', ...flight, ttl: Math.floor(NOW / 1000) - 1 }] })
    expect((await call(state, ev())).body.flight).toBeNull()
  })

  it('trip_carries_origin', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...pk, SK: 'PROFILE', inviteCode: 'X', homeCity: home } })
    ddb.on(PutCommand).resolves({})
    const r = await call(createTrip, ev({ id: 't1', dest, routeKm: 400 }))
    expect(r.status).toBe(200)
    expect(r.body.origin).toEqual(home)
    const stored = ddb.commandCalls(PutCommand)[0].args[0].input.Item!
    expect(stored.origin).toEqual(home)

    ddb.on(QueryCommand).resolves({ Items: [{ ...stored }] })
    expect((await call(state, ev())).body.trip.origin).toEqual(home)
    // trips created before origin existed still load (the client falls back to the home city)
    const { origin: _o, ...old } = stored
    ddb.on(QueryCommand).resolves({ Items: [old] })
    expect((await call(state, ev())).body.trip).toMatchObject({ id: 't1', dest })

    // no home city yet: the route has no start, so the trip is refused
    ddb.on(GetCommand).resolves({ Item: { ...pk, SK: 'PROFILE', inviteCode: 'X' } })
    expect((await call(createTrip, ev({ id: 't2', dest, routeKm: 400 }))).status).toBe(400)
  })

  it('flight_stale_ms_matches_client', () => {
    const src = readFileSync(new URL('../../src/lib/geo.ts', import.meta.url), 'utf8')
    expect(Number(src.match(/FLIGHT_STALE_MS\s*=\s*(\d+)/)![1])).toBe(FLIGHT_STALE_MS)
    expect(FLIGHT_STALE_MS).toBe(90000)
  })
})
