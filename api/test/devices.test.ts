import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { handler } from '../src/handlers/devices'
import { deviceSk } from '../src/lib/keys'

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
  ddb.on(PutCommand).callsFake((i) => (table.set(k(i.Item.PK, i.Item.SK), i.Item), {}))
  ddb.on(DeleteCommand).callsFake((i) => (table.delete(k(i.Key.PK, i.Key.SK)), {}))
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
    await put('a', 'shared-token')
    await put('b', 'shared-token')
    await put('a', 'other')
    expect((await call(ev('DELETE /devices/{token}', 'a', { token: 'shared-token' }))).status).toBe(204)
    expect(devicesOf('a').map((r) => r.token)).toEqual(['other'])
    expect(devicesOf('b').map((r) => r.token)).toEqual(['shared-token'])
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
})
