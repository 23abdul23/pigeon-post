import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { handler } from '../src/handlers/reports'

process.env.TABLE_NAME = 'PigeonPostTest'
const ddb = mockClient(DynamoDBDocumentClient)

const ev = (body: unknown, sub = 'a') =>
  ({ routeKey: 'POST /reports', body: JSON.stringify(body), requestContext: { authorizer: { jwt: { claims: { sub }, scopes: [] } } } }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
const post = async (body: unknown) => (await handler(ev(body))) as APIGatewayProxyStructuredResultV2

beforeEach(() => {
  ddb.reset()
  ddb.on(PutCommand).resolves({})
})

describe('reports', () => {
  it('report_stores_row_and_returns_204', async () => {
    const r = await post({ targetId: 'b', kind: 'letter', letterId: 'l1', reason: 'spam', note: 'ads' })
    expect(r.statusCode).toBe(204)
    const puts = ddb.commandCalls(PutCommand)
    expect(puts).toHaveLength(1)
    expect(puts[0].args[0].input.Item).toMatchObject({ reporterId: 'a', targetId: 'b', kind: 'letter', letterId: 'l1', reason: 'spam', note: 'ads' })
    expect(String(puts[0].args[0].input.Item!.PK)).toMatch(/^REPORT#/)
  })

  it('report_rejects_unknown_reason_400', async () => {
    expect((await post({ targetId: 'b', kind: 'user', reason: 'because' })).statusCode).toBe(400)
    expect((await post({ targetId: 'b', kind: 'thing', reason: 'spam' })).statusCode).toBe(400)
    expect((await post({ targetId: 'b/../x', kind: 'user', reason: 'spam' })).statusCode).toBe(400)
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('report_note_over_500_code_points_400', async () => {
    expect((await post({ targetId: 'b', kind: 'user', reason: 'other', note: '😀'.repeat(501) })).statusCode).toBe(400)
    expect((await post({ targetId: 'b', kind: 'user', reason: 'other', note: '😀'.repeat(500) })).statusCode).toBe(204)
  })

  it('report_requires_auth_401', async () => {
    const r = (await handler({ routeKey: 'POST /reports', body: '{}', requestContext: {} } as any)) as APIGatewayProxyStructuredResultV2
    expect(r.statusCode).toBe(401)
  })
})
