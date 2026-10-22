import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { handler as flight } from '../src/handlers/flight'
import { handler as postSession } from '../src/handlers/sessions'
import { FLIGHT_STALE_MS } from '../src/lib/constants'

process.env.TABLE_NAME = 'PigeonPostTest'
const ddb = mockClient(DynamoDBDocumentClient)

// In-memory table honouring the condition shapes the handlers use: `a = :v`, `a <> :v`, attribute_(not_)exists(PK), AND / OR.
const table = new Map<string, Record<string, any>>()
const k = (pk: unknown, sk: unknown) => `${pk}|${sk}`
const row = (pk: string, sk: string) => table.get(k(pk, sk))
const name = (op: any, n: string) => (n.startsWith('#') ? op.ExpressionAttributeNames[n] : n)
function holds(op: any, item: Record<string, any> | undefined): boolean {
  if (!op.ConditionExpression) return true
  return (op.ConditionExpression as string).split(' OR ').some((alt) =>
    alt.split(' AND ').every((c) => {
      if (c === 'attribute_not_exists(PK)') return !item
      if (c === 'attribute_exists(PK)') return !!item
      const [lhs, opr, rhs] = c.split(' ')
      const v = item?.[name(op, lhs)]
      return opr === '<>' ? item !== undefined && v !== op.ExpressionAttributeValues[rhs] : v === op.ExpressionAttributeValues[rhs]
    }),
  )
}
const condFail = () => Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' })
function applyUpdate(op: any) {
  const item = { ...table.get(k(op.Key.PK, op.Key.SK)) }
  const [sets, removes] = (op.UpdateExpression as string).replace(/^SET /, '').split(' REMOVE ')
  for (const set of sets.split(', ')) {
    const [lhs, rhs] = set.split(' = ')
    item[name(op, lhs)] = op.ExpressionAttributeValues[rhs]
  }
  for (const r of removes?.split(', ') ?? []) delete item[name(op, r)]
  table.set(k(op.Key.PK, op.Key.SK), item)
  return item
}
const keyOf = (t: any) => (t.Put ? t.Put.Item : (t.Update ?? t.Delete ?? t.ConditionCheck).Key)

const NOW = 1_800_000_000_000
const ev = (routeKey: string, body?: unknown, sub = 'u1', id?: string) =>
  ({
    routeKey,
    body: body === undefined ? undefined : JSON.stringify(body),
    pathParameters: id ? { id } : undefined,
    requestContext: { authorizer: { jwt: { claims: { sub }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
const call = async (h: (e: APIGatewayProxyEventV2WithJWTAuthorizer) => Promise<unknown>, e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = (await h(e)) as APIGatewayProxyStructuredResultV2
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }
}
const put = (body: Record<string, unknown>, sub = 'u1') => call(flight, ev('PUT /flight', body, sub))

const seedTrip = (over: Record<string, unknown> = {}, pk = 'USER#u1', id = 't1') =>
  table.set(k(pk, `TRIP#${id}`), { PK: pk, SK: `TRIP#${id}`, id, dest: { id: 'p', name: 'Split', country: 'Croatia', cc: 'HR', lat: 43.5, lng: 16.44 }, routeKm: 1000, progressKm: 0, status: 'OUTBOUND', legs: 0, letterIds: [], createdMs: 1, ...over })
const PHONE = 'phone-device-1'
const LAPTOP = 'laptop-device-2'
const body = (over: Record<string, unknown> = {}) => ({ tripId: 't1', startMs: NOW - 60000, durationMin: 25, baseKm: 0, deviceId: PHONE, legs: 0, ...over })
const seedFlight = (over: Record<string, unknown> = {}) =>
  table.set(k('USER#u1', 'FLIGHT'), { PK: 'USER#u1', SK: 'FLIGHT', ...body(), heartbeatMs: NOW, ttl: 0, ...over })
const LANDED = { status: 409, body: { error: 'flight already landed' } }

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  ddb.reset()
  table.clear()
  ddb.on(GetCommand).callsFake((i) => ({ Item: table.get(k(i.Key.PK, i.Key.SK)) }))
  ddb.on(QueryCommand).resolves({ Items: [] })
  ddb.on(PutCommand).callsFake((i) => {
    if (!holds(i, table.get(k(i.Item.PK, i.Item.SK)))) throw condFail()
    table.set(k(i.Item.PK, i.Item.SK), i.Item)
    return {}
  })
  ddb.on(UpdateCommand).callsFake((i) => {
    if (!holds(i, table.get(k(i.Key.PK, i.Key.SK)))) throw condFail()
    return { Attributes: applyUpdate(i) }
  })
  ddb.on(DeleteCommand).callsFake((i) => {
    if (!holds(i, table.get(k(i.Key.PK, i.Key.SK)))) throw condFail()
    table.delete(k(i.Key.PK, i.Key.SK))
    return {}
  })
  ddb.on(TransactWriteCommand).callsFake((i) => {
    const items = i.TransactItems as any[]
    expect(items.length).toBeLessThan(100)
    if (items.some((t) => !holds(t.Put ?? t.Update ?? t.Delete ?? t.ConditionCheck, table.get(k(keyOf(t).PK, keyOf(t).SK)))))
      throw new TransactionCanceledException({ message: 'cancelled', $metadata: {} })
    for (const t of items) {
      if (t.Put) table.set(k(t.Put.Item.PK, t.Put.Item.SK), t.Put.Item)
      else if (t.Update) applyUpdate(t.Update)
      else if (t.Delete) table.delete(k(t.Delete.Key.PK, t.Delete.Key.SK))
    }
    return {}
  })
})
afterEach(() => vi.useRealTimers())

describe('PUT /flight', () => {
  it('flight_put_creates_item_with_ttl', async () => {
    seedTrip()
    const r = await put(body())
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ...body(), heartbeatMs: NOW }) // legs: the trip's, so a landing (legs + 1) invalidates it
    const item = row('USER#u1', 'FLIGHT')!
    // epoch seconds, like the table's other ttl items: start + duration + 24 h
    expect(item.ttl).toBe(Math.floor((NOW - 60000) / 1000) + 25 * 60 + 24 * 3600)
    expect(item).toMatchObject({ PK: 'USER#u1', SK: 'FLIGHT', tripId: 't1', deviceId: PHONE })
  })

  it('flight_put_same_device_updates_heartbeat_only', async () => {
    seedTrip()
    seedFlight({ heartbeatMs: NOW - 30000 })
    // a heartbeat that tries to change the flight's shape changes nothing but liveness and leftAtMs
    const r = await put(body({ durationMin: 60, baseKm: 500, leftAtMs: NOW - 1000 }))
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ...body(), heartbeatMs: NOW, leftAtMs: NOW - 1000 })
    expect(row('USER#u1', 'FLIGHT')).toMatchObject({ durationMin: 25, baseKm: 0, heartbeatMs: NOW, leftAtMs: NOW - 1000 })
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0)
    expect(ddb.commandCalls(UpdateCommand)[0].args[0].input.ConditionExpression).toBe('deviceId = :d AND startMs = :s')
  })

  it('flight_put_same_device_new_start_replaces_the_flight', async () => {
    seedTrip()
    seedFlight({ heartbeatMs: NOW })
    const r = await put(body({ startMs: NOW, durationMin: 50 }))
    expect(r.status).toBe(200)
    expect(row('USER#u1', 'FLIGHT')).toMatchObject({ startMs: NOW, durationMin: 50, heartbeatMs: NOW })
  })

  it('flight_put_other_device_while_fresh_is_409_with_current_flight', async () => {
    seedTrip()
    seedFlight({ heartbeatMs: NOW - FLIGHT_STALE_MS })
    const r = await put(body({ deviceId: LAPTOP, startMs: NOW }))
    expect(r.status).toBe(409)
    expect(r.body).toEqual({ flight: { ...body(), heartbeatMs: NOW - FLIGHT_STALE_MS } }) // no PK/SK/ttl
    expect(row('USER#u1', 'FLIGHT')!.deviceId).toBe(PHONE)
  })

  it('flight_put_other_device_when_stale_takes_over', async () => {
    seedTrip()
    seedFlight({ heartbeatMs: NOW - FLIGHT_STALE_MS - 1 })
    const r = await put(body({ deviceId: LAPTOP, startMs: NOW - 1000, baseKm: 0 }))
    expect(r.status).toBe(200)
    expect(row('USER#u1', 'FLIGHT')).toMatchObject({ deviceId: LAPTOP, startMs: NOW - 1000, heartbeatMs: NOW })
    // the replace is conditional on the exact version that was judged stale
    expect(ddb.commandCalls(PutCommand)[0].args[0].input.ConditionExpression).toBe('deviceId = :d AND startMs = :s AND heartbeatMs = :hb')
  })

  it('flight_put_takeover_flag_always_wins', async () => {
    seedTrip()
    seedFlight({ heartbeatMs: NOW })
    const r = await put(body({ deviceId: LAPTOP, takeover: true }))
    expect(r.status).toBe(200)
    expect(row('USER#u1', 'FLIGHT')).toMatchObject({ deviceId: LAPTOP, heartbeatMs: NOW })
    expect(row('USER#u1', 'FLIGHT')!.takeover).toBeUndefined()
    // and the old owner's next heartbeat is now refused: one owner only
    expect((await put(body())).status).toBe(409)
  })

  it('flight_put_race_rereads_once_and_never_leaves_two_owners', async () => {
    seedTrip()
    seedFlight({ heartbeatMs: NOW - FLIGHT_STALE_MS - 1 })
    // the phone heartbeats between the laptop's read and its write
    let raced = false
    ddb.on(PutCommand).callsFake((i) => {
      if (!raced) {
        raced = true
        seedFlight({ heartbeatMs: NOW })
      }
      if (!holds(i, table.get(k(i.Item.PK, i.Item.SK)))) throw condFail()
      table.set(k(i.Item.PK, i.Item.SK), i.Item)
      return {}
    })
    const r = await put(body({ deviceId: LAPTOP, startMs: NOW }))
    expect(r.status).toBe(409)
    expect(r.body.flight.deviceId).toBe(PHONE)
    expect(row('USER#u1', 'FLIGHT')!.deviceId).toBe(PHONE)
    expect(ddb.commandCalls(GetCommand).filter((c) => c.args[0].input.Key!.SK === 'FLIGHT')).toHaveLength(2)
  })

  it('flight_for_someone_elses_trip_is_404', async () => {
    seedTrip({}, 'USER#u2')
    expect((await put(body())).status).toBe(404)
    seedTrip({ status: 'DONE' })
    expect((await put(body())).status).toBe(404) // a landed trip has no flight
    expect(row('USER#u1', 'FLIGHT')).toBeUndefined()
  })

  it('flight_rejects_duration_outside_5_to_120_min', async () => {
    seedTrip()
    for (const durationMin of [4, 121, 25.5, '25', -1]) expect((await put(body({ durationMin }))).status).toBe(400)
    for (const over of [
      { startMs: NOW + 6 * 60000 },
      { startMs: NOW - 25 * 3600000 },
      { baseKm: 1001 },
      { baseKm: -1 },
      { deviceId: 'short' },
      { deviceId: 'bad device id!' },
      { leftAtMs: NOW - 120000 },
      { tripId: 'TRIP#x/../' },
    ])
      expect((await put(body(over))).status).toBe(400)
    expect(row('USER#u1', 'FLIGHT')).toBeUndefined()
    expect((await put(body({ durationMin: 5 }))).status).toBe(200)
    expect((await put(body({ durationMin: 120, startMs: NOW }))).status).toBe(200)
  })
})

describe('DELETE /flight', () => {
  it('flight_delete_is_idempotent', async () => {
    seedFlight()
    expect((await call(flight, ev('DELETE /flight'))).status).toBe(204)
    expect(row('USER#u1', 'FLIGHT')).toBeUndefined()
    expect((await call(flight, ev('DELETE /flight'))).status).toBe(204)
    expect(ddb.commandCalls(DeleteCommand)[0].args[0].input.Key).toEqual({ PK: 'USER#u1', SK: 'FLIGHT' })
  })
})

describe('landing', () => {
  const session = (id: string, tripId = 't1', over: Record<string, unknown> = {}) =>
    call(
      postSession,
      ev(
        'POST /trips/{id}/sessions',
        { id, startMs: NOW - 5 * 60000, endMs: NOW, reason: 'completed', kmGained: 500, ...over, story: { id: `story-${id}`, place: 'Plitvice', country: 'Croatia', cc: 'HR', lens: 'Nature', text: 'Lakes.', birds: [], lat: 44.88, lng: 15.62 } },
        'u1',
        tripId,
      ),
    )

  it('session_landing_deletes_the_flight_in_the_same_transaction', async () => {
    seedTrip()
    seedFlight()
    expect((await session('s1')).status).toBe(200)
    expect(row('USER#u1', 'FLIGHT')).toBeUndefined()
    const items = ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!
    expect(items.find((t) => t.Delete)!.Delete).toMatchObject({ Key: { PK: 'USER#u1', SK: 'FLIGHT' }, ConditionExpression: 'attribute_not_exists(PK) OR tripId = :t' })

    // no flight at all (landed offline, abandoned): the landing still goes through
    expect((await session('s2')).status).toBe(200)
    // a flight on another trip is neither deleted nor a reason to cancel the landing
    seedTrip({}, 'USER#u1', 't2')
    seedFlight({ tripId: 't2' })
    expect((await session('s3')).status).toBe(200)
    expect(row('USER#u1', 'FLIGHT')!.tripId).toBe('t2')
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(3)
  })

  it('landing_a_flight_twice_yields_one_session', async () => {
    seedTrip()
    seedFlight()
    const first = await session('s1')
    seedFlight() // e.g. a late heartbeat recreated it; the replay must not count anything again
    const again = await session('s1')
    expect(again).toEqual(first)
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(1)
    expect([...table.keys()].filter((key) => key.startsWith('USER#u1|SESSION#'))).toEqual(['USER#u1|SESSION#s1'])
    expect(row('USER#u1', 'STAMP#HR')!.visits).toBe(1)
    expect(row('USER#u1', 'TRIP#t1')).toMatchObject({ legs: 1, progressKm: 500 })
  })

  it('heartbeat_after_landing_does_not_recreate_the_flight', async () => {
    seedTrip()
    expect((await put(body({ legs: 0 }))).status).toBe(200)
    expect((await session('s1', 't1', { startMs: NOW - 60000 })).status).toBe(200)
    expect(row('USER#u1', 'FLIGHT')).toBeUndefined()
    // a queued or retried heartbeat arriving after the landing: baseKm no longer matches the trip's progress
    expect(await put(body())).toEqual(LANDED)
    expect(await put(body({ leftAtMs: NOW }))).toEqual(LANDED)
    expect(row('USER#u1', 'FLIGHT')).toBeUndefined()

    // a quick leave lands 0 km, so progress is unchanged: the trip's legs (now 1) still tell
    seedTrip({ routeKm: 5000 })
    expect((await put(body({ legs: 0 }))).status).toBe(200)
    expect((await session('s2', 't1', { startMs: NOW - 60000, endMs: NOW - 60000, kmGained: 0, reason: 'left' })).status).toBe(200)
    expect(row('USER#u1', 'TRIP#t1')).toMatchObject({ progressKm: 0, legs: 1 })
    expect(await put(body({ legs: 0 }))).toEqual(LANDED)
    expect(row('USER#u1', 'FLIGHT')).toBeUndefined()
    expect((await put(body({ legs: 1, startMs: NOW }))).status).toBe(200) // the next flight is fine
  })

  it('heartbeat_racing_the_landing_returns_409_already_landed', async () => {
    seedTrip()
    seedFlight({ heartbeatMs: NOW - 30000 })
    // the landing commits between the heartbeat's read and its update
    ddb.on(UpdateCommand).callsFakeOnce(() => {
      table.delete(k('USER#u1', 'FLIGHT'))
      seedTrip({ progressKm: 500, legs: 1 })
      throw condFail()
    })
    expect(await put(body())).toEqual(LANDED)
    expect(row('USER#u1', 'FLIGHT')).toBeUndefined()
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0)
    // a surviving row from before a landing (legs moved on) is not heartbeated back to life either
    seedFlight({ heartbeatMs: NOW - 30000, baseKm: 500 })
    expect(await put(body({ baseKm: 500 }))).toEqual(LANDED)
  })

  it('replay_of_a_landing_clears_a_recreated_flight', async () => {
    seedTrip({ routeKm: 5000 })
    seedFlight({ startMs: NOW - 5 * 60000 })
    const first = await session('s1')
    expect(row('USER#u1', 'FLIGHT')).toBeUndefined()
    seedFlight({ startMs: NOW - 5 * 60000 }) // resurrected by an old client before the guard
    expect(await session('s1')).toEqual(first)
    expect(row('USER#u1', 'FLIGHT')).toBeUndefined()
    // a newer flight on the same trip (another startMs) is not the landed one: kept
    seedFlight({ startMs: NOW, baseKm: 500, legs: 1 })
    expect(await session('s1')).toEqual(first)
    expect(row('USER#u1', 'FLIGHT')).toMatchObject({ startMs: NOW })
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(1)
  })

  it('put_flight_without_legs_is_400', async () => {
    seedTrip()
    const { legs: _l, ...noLegs } = body()
    expect((await put(noLegs)).status).toBe(400)
    for (const legs of [1.5, '0', -1, null]) expect((await put(body({ legs }))).status).toBe(400)
    expect(row('USER#u1', 'FLIGHT')).toBeUndefined()
  })

  it('late_heartbeat_after_zero_km_landing_is_409_when_legs_sent', async () => {
    seedTrip({ routeKm: 5000 })
    expect((await put(body())).status).toBe(200)
    expect((await session('s1', 't1', { startMs: NOW - 60000, endMs: NOW - 60000, kmGained: 0, reason: 'left' })).status).toBe(200)
    expect(row('USER#u1', 'TRIP#t1')).toMatchObject({ progressKm: 0, legs: 1 })
    expect(await put(body())).toEqual(LANDED) // baseKm still matches; legs 0 vs the trip's 1 does not
    expect(await put(body({ takeover: true, deviceId: LAPTOP }))).toEqual(LANDED)
    expect(row('USER#u1', 'FLIGHT')).toBeUndefined()
  })

  it('landing_between_trip_read_and_flight_read_does_not_create_a_zombie', async () => {
    seedTrip({ routeKm: 5000 })
    seedFlight({ heartbeatMs: NOW - 30000 })
    // the landing commits right after the handler's first read, whichever row that is
    let landedYet = false
    ddb.on(GetCommand).callsFake((i) => {
      const item = table.get(k(i.Key.PK, i.Key.SK))
      if (!landedYet) {
        landedYet = true
        table.delete(k('USER#u1', 'FLIGHT'))
        seedTrip({ routeKm: 5000, progressKm: 105, legs: 1 })
      }
      return { Item: item }
    })
    expect(await put(body())).toEqual(LANDED)
    expect(row('USER#u1', 'FLIGHT')).toBeUndefined()
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0)
  })
})
