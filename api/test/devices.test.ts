import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { handler } from '../src/handlers/devices'
import { deviceSk, tokenPk } from '../src/lib/keys'

process.env.TABLE_NAME = 'PigeonPostTest'
const ddb = mockClient(DynamoDBDocumentClient)
const table = new Map<string, Record<string, any>>()
const k = (pk: unknown, sk: unknown) => `${pk}|${sk}`

const ev = (routeKey: string, sub: string, o: { body?: unknown; token?: string } = {}) =>
  ({ routeKey, body: o.body === undefined ? undefined : JSON.stringify(o.body), pathParameters: o.token === undefined ? undefined : { token: o.token }, requestContext: { authorizer: { jwt: { claims: { sub }, scopes: [] } } } }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
const call = async (e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = (await handler(e)) as APIGatewayProxyStructuredResultV2
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }
}
const put = (sub: string, token: unknown, platform: unknown = 'android') => call(ev('PUT /devices', sub, { body: { token, platform } }))
const devicesOf = (sub: string) => [...table.values()].filter((r) => r.PK === `USER#${sub}` && String(r.SK).startsWith('DEVICE#'))

beforeEach(() => {
  ddb.reset()
  table.clear()
  ddb.on(GetCommand).callsFake((i) => ({ Item: table.get(k(i.Key.PK, i.Key.SK)) }))
  ddb.on(DeleteCommand).callsFake((i) => {
    const cur = table.get(k(i.Key.PK, i.Key.SK))
    if (i.ConditionExpression && cur?.ownerId !== i.ExpressionAttributeValues[':me']) throw Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' })
    table.delete(k(i.Key.PK, i.Key.SK))
    return {}
  })
  ddb.on(TransactWriteCommand).callsFake((i) => {
    const ok = (i.TransactItems as any[]).every((t) => {
      if (!t.Put?.ConditionExpression) return true
      const cur = table.get(k(t.Put.Item.PK, t.Put.Item.SK))
      return t.Put.ConditionExpression === 'attribute_not_exists(PK)' ? !cur : cur?.ownerId === t.Put.ExpressionAttributeValues[':prev']
    })
    if (!ok) throw new TransactionCanceledException({ message: 'cancelled', $metadata: {} })
    for (const t of i.TransactItems as any[]) t.Put ? table.set(k(t.Put.Item.PK, t.Put.Item.SK), t.Put.Item) : table.delete(k(t.Delete.Key.PK, t.Delete.Key.SK))
    return {}
  })
  ddb.on(QueryCommand).callsFake((i) => ({
    Items: [...table.values()].filter((r) => r.PK === i.ExpressionAttributeValues[':pk'] && String(r.SK).startsWith(i.ExpressionAttributeValues[':sk'])),
  }))
})

describe('devices', () => {
  it('devices_put_stores_token_idempotently', async () => {
    expect((await put('a', 'tok:1')).status).toBe(204)
    const first = devicesOf('a')[0]
    expect(first).toMatchObject({ SK: deviceSk('tok:1'), token: 'tok:1', platform: 'android' })
    expect(first.SK).not.toContain('tok:1')
    expect((await put('a', 'tok:1')).status).toBe(204)
    expect(devicesOf('a')).toHaveLength(1)
    expect(devicesOf('a')[0].createdMs).toBe(first.createdMs)
  })

  it('devices_put_replaces_the_oldest_beyond_ten', async () => {
    for (let i = 0; i < 10; i++) {
      await put('a', `t${i}`)
      table.get(k('USER#a', deviceSk(`t${i}`)))!.createdMs = 1000 + i
    }
    expect((await put('a', 't10')).status).toBe(204)
    const tokens = devicesOf('a').map((r) => r.token)
    expect(tokens).toHaveLength(10)
    expect(tokens).not.toContain('t0')
    expect(tokens).toContain('t10')
  })

  it('devices_delete_removes_only_the_callers_token', async () => {
    await put('a', 'tok-a')
    await put('b', 'tok-b')
    await put('a', 'other')
    expect((await call(ev('DELETE /devices/{token}', 'a', { token: 'tok-b' }))).status).toBe(204) // not a's: nothing of b's moves
    expect(devicesOf('b').map((r) => r.token)).toEqual(['tok-b'])
    expect((await call(ev('DELETE /devices/{token}', 'a', { token: 'tok-a' }))).status).toBe(204)
    expect(devicesOf('a').map((r) => r.token)).toEqual(['other'])
    expect(devicesOf('b').map((r) => r.token)).toEqual(['tok-b'])
    // url-encoded path value is decoded before hashing; deleting an unknown token is fine
    await put('a', 'x:y/z')
    expect((await call(ev('DELETE /devices/{token}', 'a', { token: encodeURIComponent('x:y/z') }))).status).toBe(204)
    expect(devicesOf('a').map((r) => r.token)).toEqual(['other'])
    expect((await call(ev('DELETE /devices/{token}', 'a', { token: 'nope' }))).status).toBe(204)
  })

  it('devices_put_rejects_empty_or_oversized_token_400', async () => {
    for (const token of ['', '   ', 'x'.repeat(4097), 5, undefined, null]) expect((await put('a', token)).status).toBe(400)
    expect((await put('a', 'ok', 'ios')).status).toBe(400)
    expect((await put('a', 'x'.repeat(4096))).status).toBe(204)
    expect((await call(ev('DELETE /devices/{token}', 'a', { token: '%E0%A4%A' }))).status).toBe(400)
    expect(devicesOf('a')).toHaveLength(1)
  })

  it('devices_put_moves_ownership_and_removes_the_previous_owners_row', async () => {
    await put('a', 'phone')
    expect(table.get(k(tokenPk('phone'), 'OWNER'))).toMatchObject({ ownerId: 'a' })
    await put('b', 'phone')
    expect(devicesOf('a')).toHaveLength(0)
    expect(devicesOf('b').map((r) => r.token)).toEqual(['phone'])
    expect(table.get(k(tokenPk('phone'), 'OWNER'))).toMatchObject({ ownerId: 'b' })
  })

  it('devices_put_by_the_same_owner_is_idempotent', async () => {
    await put('a', 'phone')
    await put('a', 'phone')
    expect(devicesOf('a')).toHaveLength(1)
    expect(table.get(k(tokenPk('phone'), 'OWNER'))).toMatchObject({ ownerId: 'a' })
  })

  it('devices_delete_does_not_remove_a_token_now_owned_by_someone_else', async () => {
    await put('a', 'phone')
    await put('b', 'phone')
    await put('a', 'other') // a still has a row of their own for another token
    // a stale sign-out from a: a's own row is gone already; b's ownership and row stay
    expect((await call(ev('DELETE /devices/{token}', 'a', { token: 'phone' }))).status).toBe(204)
    expect(table.get(k(tokenPk('phone'), 'OWNER'))).toMatchObject({ ownerId: 'b' })
    expect(devicesOf('b').map((r) => r.token)).toEqual(['phone'])
    // the real owner can remove it, ownership row included
    expect((await call(ev('DELETE /devices/{token}', 'b', { token: 'phone' }))).status).toBe(204)
    expect(table.has(k(tokenPk('phone'), 'OWNER'))).toBe(false)
    expect(devicesOf('b')).toHaveLength(0)
  })
})
