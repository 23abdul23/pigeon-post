import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { accept, decline, handler, remove, request } from '../src/handlers/friends'
import { handler as state } from '../src/handlers/state'

process.env.TABLE_NAME = 'PigeonPostTest'
const ddb = mockClient(DynamoDBDocumentClient)

// In-memory table: Get / Query(GSI1) / Transact with the conditions friends.ts uses (attribute_not_exists, status = :from).
const table = new Map<string, Record<string, any>>()
const k = (pk: unknown, sk: unknown) => `${pk}|${sk}`
const row = (pk: string, sk: string) => table.get(k(pk, sk))

const ev = (opts: { sub?: string; body?: unknown; id?: string }) =>
  ({
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    pathParameters: opts.id ? { id: opts.id } : undefined,
    requestContext: { authorizer: { jwt: { claims: { sub: opts.sub ?? 'a' }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
const call = async (h: typeof request, e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = (await h(e)) as APIGatewayProxyStructuredResultV2
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }
}
const transacts = () => ddb.commandCalls(TransactWriteCommand)

const profile = (sub: string, code: string, name: string, over: Record<string, unknown> = {}) =>
  table.set(k(`USER#${sub}`, 'PROFILE'), {
    PK: `USER#${sub}`,
    SK: 'PROFILE',
    GSI1PK: `CODE#${code}`,
    GSI1SK: `USER#${sub}`,
    inviteCode: code,
    name,
    homeCity: { name: 'Zagreb', country: 'Croatia', cc: 'HR', lat: 45.81, lng: 15.98 },
    bird: { species: 'hawk', name: 'Pip' },
    email: `${sub}@example.com`, // must never reach a friend row
    ...over,
  })

function failsCondition(op: Record<string, any>, existing: Record<string, any> | undefined) {
  const c = op.ConditionExpression as string | undefined
  if (!c) return false
  if (c === 'attribute_not_exists(PK)') return !!existing
  if (c === '#s = :from') return existing?.status !== op.ExpressionAttributeValues[':from']
  throw new Error('unexpected condition ' + c)
}

beforeEach(() => {
  ddb.reset()
  table.clear()
  profile('a', 'AAAAAAAA', 'Ann')
  profile('b', 'BBBBBBBB', 'Bob', { homeCity: { name: 'Kyoto', country: 'Japan', cc: 'JP', lat: 35.01, lng: 135.77 } })
  ddb.on(GetCommand).callsFake((i) => ({ Item: table.get(k(i.Key.PK, i.Key.SK)) }))
  ddb.on(QueryCommand).callsFake((i) => ({ Items: [...table.values()].filter((r) => r[i.IndexName ? 'GSI1PK' : 'PK'] === i.ExpressionAttributeValues[':pk']) }))
  ddb.on(TransactWriteCommand).callsFake((i) => {
    const items = i.TransactItems as any[]
    const failed = items.some((t) => {
      const op = t.Put ?? t.Delete
      return failsCondition(op, table.get(k(op.Item?.PK ?? op.Key.PK, op.Item?.SK ?? op.Key.SK)))
    })
    if (failed) throw new TransactionCanceledException({ message: 'cancelled', $metadata: {} })
    for (const t of items) {
      if (t.Put) table.set(k(t.Put.Item.PK, t.Put.Item.SK), t.Put.Item)
      else table.delete(k(t.Delete.Key.PK, t.Delete.Key.SK))
    }
    return {}
  })
})

const req = (sub: string, code: string) => call(request, ev({ sub, body: { code } }))

describe('friends', () => {
  it('request_with_unknown_code_returns_404', async () => {
    expect((await req('a', 'ZZZZZZZZ')).status).toBe(404)
    expect(transacts()).toHaveLength(0)
  })

  it('request_with_incomplete_profile_code_returns_404', async () => {
    profile('c', 'CCCCCCCC', 'Cy', { homeCity: undefined })
    expect((await req('a', 'CCCCCCCC')).status).toBe(404)
  })

  it('request_with_ambiguous_code_is_409_and_writes_nothing', async () => {
    profile('c', 'BBBBBBBB', 'Cy')
    table.set(k('USER#c', 'PROFILE'), { ...row('USER#c', 'PROFILE'), GSI1PK: 'CODE#BBBBBBBB' })
    expect((await req('a', 'BBBBBBBB')).status).toBe(409)
    expect(transacts()).toHaveLength(0)
  })

  it('request_to_self_is_rejected', async () => {
    expect((await req('a', 'AAAAAAAA')).status).toBe(400)
    expect(transacts()).toHaveLength(0)
  })

  it('request_creates_mirrored_pending_rows_from_the_friends_rounded_home_city', async () => {
    const r = await req('a', 'bbbb-bbbb') // codes are typed by hand: case and dashes do not matter
    expect(r).toEqual({ status: 200, body: { id: 'b', name: 'Bob', city: 'Kyoto', cc: 'JP', lat: 35.01, lng: 135.77, status: 'pending_out' } })
    expect(row('USER#a', 'FRIEND#b')).toMatchObject({ status: 'pending_out', name: 'Bob' })
    expect(row('USER#b', 'FRIEND#a')).toMatchObject({ id: 'a', status: 'pending_in', name: 'Ann', city: 'Zagreb' })
    expect(transacts()).toHaveLength(1)
  })

  it('duplicate_request_is_idempotent', async () => {
    const first = await req('a', 'BBBBBBBB')
    const again = await req('a', 'BBBBBBBB')
    expect(again).toEqual(first)
    expect(transacts()).toHaveLength(1)
    expect([...table.keys()].filter((x) => x.includes('FRIEND#'))).toHaveLength(2)
  })

  it('request_to_someone_who_already_asked_me_accepts', async () => {
    await req('b', 'AAAAAAAA')
    const r = await req('a', 'BBBBBBBB')
    expect(r.body.status).toBe('accepted')
    expect(row('USER#b', 'FRIEND#a')!.status).toBe('accepted')
  })

  it('accept_makes_both_sides_accepted', async () => {
    await req('a', 'BBBBBBBB')
    const r = await call(accept, ev({ sub: 'b', id: 'a' }))
    expect(r).toMatchObject({ status: 200, body: { id: 'a', status: 'accepted' } })
    expect(row('USER#a', 'FRIEND#b')!.status).toBe('accepted')
    expect(row('USER#b', 'FRIEND#a')!.status).toBe('accepted')
    expect((await call(accept, ev({ sub: 'b', id: 'a' }))).body.status).toBe('accepted') // replay
  })

  it('only_the_receiver_can_accept', async () => {
    await req('a', 'BBBBBBBB')
    expect((await call(accept, ev({ sub: 'a', id: 'b' }))).status).toBe(409) // sender cannot accept their own request
    expect((await call(accept, ev({ sub: 'b', id: 'zzz' }))).status).toBe(404)
    expect(row('USER#b', 'FRIEND#a')!.status).toBe('pending_in')
  })

  it('decline_removes_pending_both_sides', async () => {
    await req('a', 'BBBBBBBB')
    expect((await call(decline, ev({ sub: 'b', id: 'a' }))).status).toBe(204)
    expect(row('USER#a', 'FRIEND#b')).toBeUndefined()
    expect(row('USER#b', 'FRIEND#a')).toBeUndefined()
    expect((await call(decline, ev({ sub: 'b', id: 'a' }))).status).toBe(204) // nothing left: still fine
  })

  it('decline_does_not_unfriend', async () => {
    await req('a', 'BBBBBBBB')
    await call(accept, ev({ sub: 'b', id: 'a' }))
    expect((await call(decline, ev({ sub: 'b', id: 'a' }))).status).toBe(409)
    expect(row('USER#a', 'FRIEND#b')!.status).toBe('accepted')
  })

  it('friend_row_never_includes_email', async () => {
    await req('a', 'BBBBBBBB')
    await call(accept, ev({ sub: 'b', id: 'a' }))
    for (const r of [row('USER#a', 'FRIEND#b'), row('USER#b', 'FRIEND#a')]) expect(JSON.stringify(r)).not.toMatch(/email|@/)
    const s = await call(state as typeof request, ev({ sub: 'a' }))
    expect(JSON.stringify(s.body.friends)).not.toMatch(/email|@/)
  })

  it('get_state_lists_friends_from_the_callers_partition_only', async () => {
    profile('c', 'CCCCCCCC', 'Cy')
    await req('a', 'BBBBBBBB')
    await req('b', 'CCCCCCCC')
    const s = await call(state as typeof request, ev({ sub: 'a' }))
    expect(s.body.friends).toEqual([{ id: 'b', name: 'Bob', city: 'Kyoto', cc: 'JP', lat: 35.01, lng: 135.77, status: 'pending_out' }])
  })

  it('delete_friend_removes_both_rows', async () => {
    await req('a', 'BBBBBBBB')
    await call(accept, ev({ sub: 'b', id: 'a' }))
    expect((await call(remove, ev({ sub: 'a', id: 'b' }))).status).toBe(204)
    expect(row('USER#a', 'FRIEND#b')).toBeUndefined()
    expect(row('USER#b', 'FRIEND#a')).toBeUndefined()
    expect(row('USER#a', 'PROFILE')).toBeDefined()
  })

  it('cancelled_transaction_is_retried_then_503', async () => {
    ddb.on(TransactWriteCommand).rejects(new TransactionCanceledException({ message: 'cancelled', $metadata: {} }))
    expect((await req('a', 'BBBBBBBB')).status).toBe(503)
    expect(transacts()).toHaveLength(3)
  })

  it('routes_by_routeKey', async () => {
    const e = { ...ev({ sub: 'a', body: { code: 'BBBBBBBB' } }), routeKey: 'POST /friends/request' }
    expect((await call(handler as never, e as never)).status).toBe(200)
    expect((await call(handler as never, { ...ev({ sub: 'a', id: 'b' }), routeKey: 'DELETE /friends/{id}' } as never)).status).toBe(204)
    expect((await call(handler as never, { ...ev({}), routeKey: 'GET /nope' } as never)).status).toBe(404)
  })
})
