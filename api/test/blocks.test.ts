import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { handler } from '../src/handlers/blocks'

process.env.TABLE_NAME = 'PigeonPostTest'
const ddb = mockClient(DynamoDBDocumentClient)

const table = new Map<string, Record<string, any>>()
const k = (pk: unknown, sk: unknown) => `${pk}|${sk}`
const row = (pk: string, sk: string) => table.get(k(pk, sk))

const ev = (routeKey: string, sub: string, id?: string) =>
  ({ routeKey, pathParameters: id ? { id } : undefined, requestContext: { authorizer: { jwt: { claims: { sub }, scopes: [] } } } }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
const call = async (e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = (await handler(e)) as APIGatewayProxyStructuredResultV2
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }
}
const block = (sub: string, id: string) => call(ev('POST /blocks/{id}', sub, id))

const friends = (x: string, y: string) => {
  table.set(k(`USER#${x}`, `FRIEND#${y}`), { PK: `USER#${x}`, SK: `FRIEND#${y}`, id: y, status: 'accepted' })
  table.set(k(`USER#${y}`, `FRIEND#${x}`), { PK: `USER#${y}`, SK: `FRIEND#${x}`, id: x, status: 'accepted' })
}

beforeEach(() => {
  ddb.reset()
  table.clear()
  ddb.on(GetCommand).callsFake((i) => ({ Item: table.get(k(i.Key.PK, i.Key.SK)) }))
  ddb.on(QueryCommand).callsFake((i) => {
    const prefix = i.ExpressionAttributeValues[':sk'] as string
    return { Items: [...table.values()].filter((r) => r.PK === i.ExpressionAttributeValues[':pk'] && String(r.SK).startsWith(prefix)) }
  })
  ddb.on(DeleteCommand).callsFake((i) => (table.delete(k(i.Key.PK, i.Key.SK)), {}))
  ddb.on(TransactWriteCommand).callsFake((i) => {
    for (const t of i.TransactItems as any[]) {
      if (t.Put) table.set(k(t.Put.Item.PK, t.Put.Item.SK), t.Put.Item)
      else table.delete(k(t.Delete.Key.PK, t.Delete.Key.SK))
    }
    return {}
  })
})

describe('blocks', () => {
  it('block_creates_a_row_and_removes_friendship_both_ways', async () => {
    friends('a', 'b')
    expect((await block('a', 'b')).status).toBe(204)
    expect(row('USER#a', 'BLOCK#b')).toMatchObject({ PK: 'USER#a', SK: 'BLOCK#b', id: 'b' })
    expect(row('USER#b', 'BLOCK#a')).toBeUndefined() // the blocked person never gets a row saying so
    expect(row('USER#a', 'FRIEND#b')).toBeUndefined()
    expect(row('USER#b', 'FRIEND#a')).toBeUndefined()
  })

  it('block_self_is_400', async () => {
    expect((await block('a', 'a')).status).toBe(400)
    expect(table.size).toBe(0)
  })

  it('block_is_idempotent', async () => {
    friends('a', 'b')
    expect((await block('a', 'b')).status).toBe(204)
    expect((await block('a', 'b')).status).toBe(204)
    expect([...table.keys()]).toEqual(['USER#a|BLOCK#b'])
  })

  it('unblock_removes_the_row', async () => {
    await block('a', 'b')
    expect((await call(ev('DELETE /blocks/{id}', 'a', 'b'))).status).toBe(204)
    expect(row('USER#a', 'BLOCK#b')).toBeUndefined()
    expect((await call(ev('DELETE /blocks/{id}', 'a', 'b'))).status).toBe(204) // already gone is fine
  })

  it('list_returns_only_my_blocks', async () => {
    await block('a', 'b')
    await block('a', 'c')
    await block('z', 'y')
    const r = await call(ev('GET /blocks', 'a'))
    expect(r.status).toBe(200)
    expect([...r.body.ids].sort()).toEqual(['b', 'c'])
  })

  it('block_requires_auth_401', async () => {
    const r = (await handler({ routeKey: 'POST /blocks/{id}', pathParameters: { id: 'b' }, requestContext: {} } as any)) as APIGatewayProxyStructuredResultV2
    expect(r.statusCode).toBe(401)
  })
})
