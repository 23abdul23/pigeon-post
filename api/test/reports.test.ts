import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { handler } from '../src/handlers/reports'

process.env.TABLE_NAME = 'PigeonPostTest'
const ddb = mockClient(DynamoDBDocumentClient)
const ses = mockClient(SESv2Client)
let used = 0 // today's report counter, enforced like the conditional UpdateItem

const ev = (body: unknown, sub = 'a') =>
  ({ routeKey: 'POST /reports', body: JSON.stringify(body), requestContext: { authorizer: { jwt: { claims: { sub }, scopes: [] } } } }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
const post = async (body: unknown) => (await handler(ev(body))) as APIGatewayProxyStructuredResultV2

beforeEach(() => {
  ddb.reset()
  used = 0
  ses.reset()
  ses.on(SendEmailCommand).resolves({})
  delete process.env.MODERATOR_EMAIL
  delete process.env.SES_SENDER
  ddb.on(PutCommand).resolves({})
  ddb.on(UpdateCommand).callsFake((i) => {
    if (used >= i.ExpressionAttributeValues[':cap']) throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' })
    used++
    return {}
  })
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

  it('report_under_the_cap_still_returns_204', async () => {
    used = 19
    expect((await post({ targetId: 'b', kind: 'user', reason: 'spam' })).statusCode).toBe(204)
    expect(ddb.commandCalls(UpdateCommand)[0].args[0].input.Key).toMatchObject({ PK: 'USER#a', SK: expect.stringMatching(/^USAGE#report#\d{4}-\d{2}-\d{2}$/) })
  })

  it('report_over_the_daily_cap_is_429_and_stores_nothing', async () => {
    used = 20
    const r = await post({ targetId: 'b', kind: 'user', reason: 'spam' })
    expect(r.statusCode).toBe(429)
    expect(r.body).not.toMatch(/20/)
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('report_email_is_skipped_above_the_cap', async () => {
    process.env.MODERATOR_EMAIL = 'mod@example.com'
    process.env.SES_SENDER = 'hi@example.com'
    expect((await post({ targetId: 'b', kind: 'user', reason: 'spam' })).statusCode).toBe(204)
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(1)
    used = 20
    expect((await post({ targetId: 'b', kind: 'user', reason: 'spam' })).statusCode).toBe(429)
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(1)
  })
})
