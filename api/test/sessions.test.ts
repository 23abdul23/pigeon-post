import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { handler as postSession } from '../src/handlers/sessions'
import { createTrip, returnTrip } from '../src/handlers/trips'
import { handler as putStory } from '../src/handlers/stories'

process.env.TABLE_NAME = 'PigeonPostTest'
const ddb = mockClient(DynamoDBDocumentClient)

// A tiny in-memory table: Get reads it, Transact/Put write it, honouring attribute_not_exists like DynamoDB.
const table = new Map<string, Record<string, unknown>>()
const key = (k: Record<string, unknown>) => `${k.PK}|${k.SK}`
const row = (pk: string, sk: string) => table.get(`${pk}|${sk}`)

const ev = (opts: { body?: unknown; id?: string; sub?: string }) =>
  ({
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    pathParameters: opts.id ? { id: opts.id } : undefined,
    requestContext: { authorizer: { jwt: { claims: { sub: opts.sub ?? 'u1' }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer

const call = async (h: typeof postSession, e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = (await h(e)) as APIGatewayProxyStructuredResultV2
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }
}

const dest = { id: 'p1', name: 'Split', country: 'Croatia', cc: 'HR', lat: 43.5, lng: 16.44 }
const seedTrip = (over: Record<string, unknown> = {}, pk = 'USER#u1') =>
  table.set(`${pk}|TRIP#t1`, { PK: pk, SK: 'TRIP#t1', id: 't1', dest, routeKm: 1000, progressKm: 0, status: 'OUTBOUND', legs: 0, letterIds: [], createdMs: 1, ...over })

const story = (over: Record<string, unknown> = {}) => ({
  id: 'st1',
  place: 'Plitvice',
  country: 'Croatia',
  cc: 'HR',
  lens: 'Nature',
  text: 'Lakes.',
  birds: ['Grey heron'],
  km: 0,
  lat: 44.88123,
  lng: 15.61987,
  ...over,
})
const FIVE_MIN = 5 * 60000
const session = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  startMs: 1_000_000,
  endMs: 1_000_000 + FIVE_MIN,
  reason: 'completed',
  kmGained: 500,
  story: story({ id: `story-${id}` }),
  ...over,
})
const transacts = () => ddb.commandCalls(TransactWriteCommand)

beforeEach(() => {
  ddb.reset()
  table.clear()
  ddb.on(GetCommand).callsFake((input) => ({ Item: table.get(key(input.Key)) }))
  ddb.on(TransactWriteCommand).callsFake((input) => {
    const puts = input.TransactItems.map((t: { Put: { Item: Record<string, unknown>; ConditionExpression?: string } }) => t.Put)
    if (puts.some((p: { Item: Record<string, unknown>; ConditionExpression?: string }) => p.ConditionExpression === 'attribute_not_exists(PK)' && table.has(key(p.Item))))
      throw new TransactionCanceledException({ message: 'cancelled', $metadata: {} })
    for (const p of puts) table.set(key(p.Item), p.Item)
    return {}
  })
})

describe('POST /trips/{id}/sessions', () => {
  it('session_post_is_idempotent_on_id', async () => {
    seedTrip()
    const first = await call(postSession, ev({ id: 't1', body: session('s1', { kmGained: 60000 }) }))
    expect(first.status).toBe(200)
    expect(first.body.trip.progressKm).toBeCloseTo(525) // clamped: 5 min * 100 km/min * 1.05
    const again = await call(postSession, ev({ id: 't1', body: session('s1', { kmGained: 60000 }) }))
    expect(again).toEqual(first)
    expect(transacts()).toHaveLength(1)
    expect(row('USER#u1', 'TRIP#t1')!.progressKm).toBeCloseTo(525)
    expect(row('USER#u1', 'STAMP#HR')!.visits).toBe(1)
    expect(first.body.story).toMatchObject({ id: 'story-s1', saved: false, lat: 44.88, lng: 15.62 })
    expect(first.body).toMatchObject({ delivered: [], pickedUp: [] })
    expect(row('USER#u1', 'SESSION#s1')).toMatchObject({ id: 's1', tripId: 't1', reason: 'completed' })
  })

  it('first_session_in_a_country_creates_stamp_second_increments_visits', async () => {
    seedTrip({ routeKm: 5000 })
    const a = await call(postSession, ev({ id: 't1', body: session('s1') }))
    expect(a.body.stamp).toMatchObject({ cc: 'HR', country: 'Croatia', visits: 1 })
    const b = await call(postSession, ev({ id: 't1', body: session('s2') }))
    expect(b.body.stamp).toEqual({ ...a.body.stamp, visits: 2 })
    expect(row('USER#u1', 'STAMP#HR')).toMatchObject({ visits: 2, firstMs: a.body.stamp.firstMs })
    expect(b.body.trip).toMatchObject({ progressKm: 1000, legs: 2 })
  })

  it('session_for_someone_elses_trip_is_404', async () => {
    seedTrip({}, 'USER#u2')
    const r = await call(postSession, ev({ id: 't1', body: session('s1') }))
    expect(r.status).toBe(404)
    expect(transacts()).toHaveLength(0)
  })

  it('session_with_non_2_letter_cc_is_400', async () => {
    seedTrip()
    for (const cc of ['HRV', 'H', 'h1', 'hr', ''])
      expect((await call(postSession, ev({ id: 't1', body: session('s1', { story: story({ cc }) }) }))).status).toBe(400)
    expect((await call(postSession, ev({ id: 't1', body: session('s1', { reason: 'cheated' }) }))).status).toBe(400)
    expect((await call(postSession, ev({ id: 't1', body: session('s1', { story: story({ text: 'x'.repeat(5000) }) }) }))).status).toBe(400)
    expect(transacts()).toHaveLength(0)
  })

  it('trip_completes_when_progress_reaches_routeKm', async () => {
    seedTrip({ progressKm: 900 })
    const solo = await call(postSession, ev({ id: 't1', body: session('s1') }))
    expect(solo.body.trip).toMatchObject({ progressKm: 1000, status: 'DONE' })
    expect(solo.body.trip.route).toBeUndefined()
    expect(solo.body.trip.createdMs).toBeUndefined()

    seedTrip({ progressKm: 900, friendId: 'f1' })
    expect((await call(postSession, ev({ id: 't1', body: session('s2') }))).body.trip.status).toBe('DELIVERED')

    seedTrip({ progressKm: 900, status: 'RETURNING', friendId: 'f1' })
    expect((await call(postSession, ev({ id: 't1', body: session('s3') }))).body.trip.status).toBe('DONE')

    seedTrip({ progressKm: 0 })
    expect((await call(postSession, ev({ id: 't1', body: session('s4', { kmGained: 100 }) }))).body.trip).toMatchObject({ progressKm: 100, status: 'OUTBOUND' })
  })

  it('session_replayed_concurrently_returns_the_stored_result', async () => {
    seedTrip()
    const first = await call(postSession, ev({ id: 't1', body: session('s1') }))
    // the replay's existence check missed (raced the first write); the conditional put catches it
    let misses = 1
    ddb.on(GetCommand).callsFake((input) => (input.Key.SK === 'SESSION#s1' && misses-- > 0 ? {} : { Item: table.get(key(input.Key)) }))
    expect(await call(postSession, ev({ id: 't1', body: session('s1') }))).toEqual(first)
    expect(row('USER#u1', 'TRIP#t1')!.progressKm).toBe(500)
  })
})

describe('POST /trips and /trips/{id}/return', () => {
  it('post_trip_creates_outbound_trip_and_is_idempotent', async () => {
    ddb.on(PutCommand).callsFake((input) => {
      if (table.has(key(input.Item))) throw Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' })
      table.set(key(input.Item), input.Item)
      return {}
    })
    const body = { id: 't9', dest: { ...dest, lat: 43.50812 }, routeKm: 400, friendId: 'f1' }
    const r = await call(createTrip, ev({ body }))
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ id: 't9', dest: { ...dest, lat: 43.51 }, routeKm: 400, friendId: 'f1', letterIds: [], progressKm: 0, status: 'OUTBOUND', legs: 0 })
    expect(await call(createTrip, ev({ body }))).toEqual(r)
    expect((await call(createTrip, ev({ body: { ...body, dest: { ...dest, cc: 'XYZ' } } }))).status).toBe(400)
  })

  it('return_resets_a_delivered_trip_and_404s_for_unknown_trip', async () => {
    ddb.on(UpdateCommand).callsFake((input) => {
      const t = table.get(key(input.Key))
      if (!t || t.status !== 'DELIVERED') throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' })
      const next = { ...t, status: 'RETURNING', progressKm: 0 }
      table.set(key(input.Key), next)
      return { Attributes: next }
    })
    expect((await call(returnTrip, ev({ id: 't1' }))).status).toBe(404)
    seedTrip({ status: 'DELIVERED', progressKm: 1000, friendId: 'f1' })
    const r = await call(returnTrip, ev({ id: 't1' }))
    expect(r.body).toMatchObject({ id: 't1', status: 'RETURNING', progressKm: 0 })
    expect(await call(returnTrip, ev({ id: 't1' }))).toEqual(r) // replay is a no-op
    seedTrip({ status: 'OUTBOUND' })
    expect((await call(returnTrip, ev({ id: 't1' }))).status).toBe(409)
  })
})

describe('PUT /stories/{id}', () => {
  it('put_story_sets_saved_and_404s_for_missing_story', async () => {
    ddb.on(UpdateCommand).callsFake((input) => {
      const s = table.get(key(input.Key))
      if (!s) throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' })
      return { Attributes: { ...s, saved: input.ExpressionAttributeValues[':saved'] } }
    })
    expect((await call(putStory, ev({ id: 'st1', body: { saved: true } }))).status).toBe(404)
    table.set('USER#u1|STORY#st1', { PK: 'USER#u1', SK: 'STORY#st1', id: 'st1', saved: false })
    expect((await call(putStory, ev({ id: 'st1', body: { saved: true } }))).body).toEqual({ id: 'st1', saved: true })
    expect((await call(putStory, ev({ id: 'st1', body: { saved: 'yes' } }))).status).toBe(400)
  })
})
