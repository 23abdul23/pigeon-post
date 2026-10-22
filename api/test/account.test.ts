import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { AdminDeleteUserCommand, CognitoIdentityProviderClient, UserNotFoundException } from '@aws-sdk/client-cognito-identity-provider'
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { handler as deleteMe } from '../src/handlers/account'
import { handler as postSession } from '../src/handlers/sessions'
import { returnTrip } from '../src/handlers/trips'
import { handler as state } from '../src/handlers/state'

process.env.TABLE_NAME = 'PigeonPostTest'
process.env.LETTERS_BUCKET = 'letters-test-bucket'
process.env.USER_POOL_ID = 'us-east-1_pool'
process.env.SES_SENDER = 'post@pigeon.example'
process.env.AWS_REGION = 'us-east-1'
const ddb = mockClient(DynamoDBDocumentClient)
const s3 = mockClient(S3Client)
const cognito = mockClient(CognitoIdentityProviderClient)
const ses = mockClient(SESv2Client)

// In-memory table with the condition forms the handlers use: attribute_(not_)exists(PK), `a = :v` joined by AND, `#s IN (:a, :b)`.
const table = new Map<string, Record<string, any>>()
const k = (pk: unknown, sk: unknown) => `${pk}|${sk}`
const row = (pk: string, sk: string) => table.get(k(pk, sk))
const name = (op: any, n: string) => (n.startsWith('#') ? op.ExpressionAttributeNames[n] : n)
function holds(op: any, item: Record<string, any> | undefined) {
  if (!op.ConditionExpression) return true
  return (op.ConditionExpression as string).split(' AND ').every((c) => {
    if (c === 'attribute_not_exists(PK)') return !item
    if (c === 'attribute_exists(PK)') return !!item
    const inList = c.match(/^(\S+) IN \((.+)\)$/)
    if (inList) return !!item && inList[2].split(', ').some((v) => item[name(op, inList[1])] === op.ExpressionAttributeValues[v])
    const [lhs, rhs] = c.split(' = ')
    return item?.[name(op, lhs)] === op.ExpressionAttributeValues[rhs]
  })
}
function applyUpdate(op: any) {
  const item = { ...table.get(k(op.Key.PK, op.Key.SK)) }
  for (const set of (op.UpdateExpression as string).replace(/^SET /, '').split(', ')) {
    const [lhs, rhs] = set.split(' = ')
    item[name(op, lhs)] = op.ExpressionAttributeValues[rhs]
  }
  table.set(k(op.Key.PK, op.Key.SK), item)
  return item
}
const condFail = () => Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' })

const ev = (o: { sub?: string; id?: string; body?: unknown } = {}) =>
  ({
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    pathParameters: o.id ? { id: o.id } : undefined,
    requestContext: { authorizer: { jwt: { claims: { sub: o.sub ?? 'a', 'cognito:username': `google_${o.sub ?? 'a'}` }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
const call = async (h: (e: APIGatewayProxyEventV2WithJWTAuthorizer) => Promise<unknown>, e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = (await h(e)) as APIGatewayProxyStructuredResultV2
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }
}

const put = (item: Record<string, any>) => table.set(k(item.PK, item.SK), item)
const profile = (sub: string, n: string, settings: Record<string, unknown> = { notifyLetter: true, channel: 'email' }) =>
  put({ PK: `USER#${sub}`, SK: 'PROFILE', GSI1PK: `CODE#${sub.toUpperCase().repeat(8)}`, GSI1SK: `USER#${sub}`, inviteCode: sub.toUpperCase().repeat(8), name: n, email: `${sub}@example.com`, homeCity: { name: 'X', country: 'X', cc: 'HR', lat: 1, lng: 2 }, settings })
const friends = (x: string, y: string, xs = 'accepted', ys = xs) => {
  put({ PK: `USER#${x}`, SK: `FRIEND#${y}`, id: y, name: y, city: 'X', cc: 'HR', lat: 1, lng: 2, status: xs })
  put({ PK: `USER#${y}`, SK: `FRIEND#${x}`, id: x, name: x, city: 'X', cc: 'HR', lat: 1, lng: 2, status: ys })
}
/** Both copies of a letter, as POST /letters writes them. */
const letter = (id: string, fromId: string, toId: string, status: string, over: Record<string, unknown> = {}) => {
  const l = { id, fromId, toId, fromName: fromId === 'a' ? 'Ann Smith' : 'Bob', fromCity: 'X', cc: 'HR', text: 'secret words', attachments: [], status, dateMs: 1, ...over }
  put({ PK: `USER#${toId}`, SK: `LETTER#${id}`, ...l, box: 'in' })
  put({ PK: `USER#${fromId}`, SK: `SENT#${id}`, ...l, box: 'sent' })
}
const seedTrip = (sub: string, friendId: string, over: Record<string, unknown> = {}) =>
  put({ PK: `USER#${sub}`, SK: 'TRIP#t1', id: 't1', dest: { id: 'p', name: 'Kyoto', country: 'JP', cc: 'JP', lat: 1, lng: 2 }, routeKm: 1000, progressKm: 900, status: 'OUTBOUND', legs: 3, friendId, letterIds: [], createdMs: 1, ...over })
const fly = (sub: string, sessionId: string) =>
  call(postSession, {
    ...ev({ sub, id: 't1' }),
    body: JSON.stringify({
      id: sessionId,
      startMs: 1_000_000,
      endMs: 1_000_000 + 5 * 60000,
      reason: 'completed',
      kmGained: 500,
      story: { id: `story-${sessionId}`, place: 'Kyoto', country: 'Japan', cc: 'JP', lens: 'Nature', text: 'Moss.', birds: [], lat: 1, lng: 2 },
    }),
  })
const rowsOf = (sub: string) => [...table.values()].filter((r) => r.PK === `USER#${sub}`)

let objects: string[]
beforeEach(() => {
  for (const m of [ddb, s3, cognito, ses]) m.reset()
  table.clear()
  objects = []
  ddb.on(GetCommand).callsFake((i) => ({ Item: table.get(k(i.Key.PK, i.Key.SK)) }))
  ddb.on(QueryCommand).callsFake((i) => {
    const prefix = i.ExpressionAttributeValues[':sk'] ?? ''
    return { Items: [...table.values()].filter((r) => r.PK === i.ExpressionAttributeValues[':pk'] && String(r.SK).startsWith(prefix)) }
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
  ddb.on(BatchWriteCommand).callsFake((i) => {
    for (const r of i.RequestItems.PigeonPostTest) table.delete(k(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK))
    return {}
  })
  ddb.on(TransactWriteCommand).callsFake((i) => {
    const items = (i.TransactItems as any[]).filter((t) => t.Put || t.Update) // the FLIGHT delete/check: api/test/flight.test.ts
    if (items.some((t) => (t.Put ? !holds(t.Put, table.get(k(t.Put.Item.PK, t.Put.Item.SK))) : !holds(t.Update, table.get(k(t.Update.Key.PK, t.Update.Key.SK))))))
      throw new TransactionCanceledException({ message: 'cancelled', $metadata: {} })
    for (const t of items) t.Put ? put(t.Put.Item) : applyUpdate(t.Update)
    return {}
  })
  // S3 lists one key per page, so paging is exercised; like S3, the token is the last key returned, so deleting while paging is safe
  s3.on(ListObjectsV2Command).callsFake((i) => {
    const after = objects.filter((o) => o.startsWith(i.Prefix) && (!i.ContinuationToken || o > i.ContinuationToken)).sort()
    return { Contents: after.slice(0, 1).map((Key) => ({ Key })), IsTruncated: after.length > 1, NextContinuationToken: after[0] }
  })
  s3.on(DeleteObjectsCommand).callsFake((i) => {
    const gone = new Set(i.Delete.Objects.map((o: { Key: string }) => o.Key))
    objects = objects.filter((o) => !gone.has(o))
    return { Errors: [] }
  })
  cognito.on(AdminDeleteUserCommand).resolves({})
  ses.on(SendEmailCommand).resolves({ MessageId: 'm1' })
})

describe('DELETE /me', () => {
  it('delete_me_removes_all_user_items', async () => {
    profile('a', 'Ann')
    profile('b', 'Bob')
    seedTrip('a', 'b')
    put({ PK: 'USER#a', SK: 'SESSION#s1', id: 's1' })
    put({ PK: 'USER#a', SK: 'STAMP#HR', cc: 'HR' })
    for (let i = 0; i < 30; i++) put({ PK: 'USER#a', SK: `STORY#${i}`, id: String(i) }) // more than one 25-item batch
    friends('a', 'b')
    letter('l1', 'b', 'a', 'OPENED')
    objects = ['letters/a/k1', 'letters/a/k2', 'letters/a/k3', 'letters/b/k9']

    // first batch comes back partly unprocessed: the handler retries it
    let first = true
    ddb.on(BatchWriteCommand).callsFake((i) => {
      const reqs = i.RequestItems.PigeonPostTest
      const done = first ? reqs.slice(1) : reqs
      for (const r of done) table.delete(k(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK))
      const left = first ? reqs.slice(0, 1) : []
      first = false
      return { UnprocessedItems: left.length ? { PigeonPostTest: left } : {} }
    })
    // a failure part-way leaves the profile and the Cognito user, so the request can be run again
    s3.on(DeleteObjectsCommand).rejectsOnce(new Error('S3 down')).callsFake((i) => {
      const gone = new Set(i.Delete.Objects.map((o: { Key: string }) => o.Key))
      objects = objects.filter((o) => !gone.has(o))
      return { Errors: [] }
    })
    await expect(deleteMe(ev())).rejects.toThrow('S3 down')
    expect(row('USER#a', 'PROFILE')).toBeDefined()
    expect(cognito.commandCalls(AdminDeleteUserCommand)).toHaveLength(0)

    expect((await call(deleteMe, ev())).status).toBe(204)
    expect(rowsOf('a')).toEqual([])
    expect([...table.values()].some((r) => r.GSI1SK === 'USER#a' || r.GSI1PK === 'CODE#AAAAAAAA')).toBe(false) // the invite code went with the profile
    expect(objects).toEqual(['letters/b/k9'])
    expect(s3.commandCalls(ListObjectsV2Command).every((c) => c.args[0].input.Prefix === 'letters/a/')).toBe(true)
    expect(cognito.commandCalls(AdminDeleteUserCommand).map((c) => c.args[0].input)).toEqual([{ UserPoolId: 'us-east-1_pool', Username: 'google_a' }])
    expect(row('USER#b', 'PROFILE')).toBeDefined()
    expect(row('USER#b', 'SENT#l1')).toBeDefined() // a delivered letter stays in the other person's box

    // again, with nothing left (the Cognito user is already gone): still 204
    cognito.on(AdminDeleteUserCommand).rejects(new UserNotFoundException({ message: 'gone', $metadata: {} }))
    expect((await call(deleteMe, ev())).status).toBe(204)
  })

  it('delete_me_marks_friend_rows_deleted_for_others', async () => {
    profile('a', 'Ann')
    profile('b', 'Bob')
    profile('c', 'Cy')
    profile('d', 'Di')
    friends('a', 'b')
    friends('a', 'c', 'pending_out', 'pending_in')
    friends('a', 'd', 'pending_in', 'pending_out')
    put({ PK: 'USER#a', SK: 'FRIEND#e', id: 'e', status: 'accepted' }) // their side is already gone: nothing recreated

    expect((await call(deleteMe, ev())).status).toBe(204)
    expect(row('USER#b', 'FRIEND#a')).toMatchObject({ id: 'a', name: 'a', status: 'removed' })
    expect(row('USER#c', 'FRIEND#a')).toBeUndefined() // a pending request just goes away
    expect(row('USER#d', 'FRIEND#a')).toBeUndefined()
    expect(row('USER#e', 'FRIEND#a')).toBeUndefined()
    const bob = await call(state, ev({ sub: 'b' }))
    expect(bob.body.friends).toEqual([expect.objectContaining({ id: 'a', status: 'removed' })])
  })

  it('delete_me_drops_inflight_letters_to_deleted_user', async () => {
    profile('a', 'Ann')
    profile('b', 'Bob')
    friends('a', 'b')
    letter('w', 'b', 'a', 'WAITING') // Bob's letter waiting for Ann's bird
    letter('c', 'b', 'a', 'CARRIED') // on Bob's bird toward Ann
    letter('mine', 'a', 'b', 'CARRIED') // on Ann's bird toward Bob
    letter('done', 'a', 'b', 'DELIVERED')
    seedTrip('b', 'a') // Bob is flying to Ann

    expect((await call(deleteMe, ev())).status).toBe(204)
    expect(row('USER#b', 'SENT#w')).toBeUndefined()
    expect(row('USER#b', 'SENT#c')).toBeUndefined()
    expect(row('USER#b', 'LETTER#mine')).toBeUndefined()
    expect(row('USER#b', 'LETTER#done')).toMatchObject({ status: 'DELIVERED' })

    // Bob's trip to the deleted friend still lands and comes home, moving nothing
    const there = await fly('b', 's1')
    expect(there.status).toBe(200)
    expect(there.body).toMatchObject({ delivered: [], pickedUp: [] })
    expect((await call(returnTrip, ev({ sub: 'b', id: 't1' }))).body.status).toBe('RETURNING')
    row('USER#b', 'TRIP#t1')!.progressKm = 900
    const home = await fly('b', 's2')
    expect(home.status).toBe(200)
    expect(home.body.trip.status).toBe('DONE')
  })
})

describe('arrival email', () => {
  const arrive = async (bobSettings: Record<string, unknown>) => {
    profile('a', 'Ann Smith')
    profile('b', 'Bob', bobSettings)
    friends('a', 'b')
    letter('l1', 'a', 'b', 'CARRIED')
    seedTrip('a', 'b')
    return fly('a', 's1')
  }

  it('arrival_email_not_sent_when_notifications_off', async () => {
    expect((await arrive({ notifyLetter: false, channel: 'email' })).body.delivered).toHaveLength(1)
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0)

    table.clear()
    expect((await arrive({ notifyLetter: true, channel: 'browser' })).body.delivered).toHaveLength(1)
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0)

    // on, by email: one message to the recipient, naming the sender's first name and none of the letter
    table.clear()
    await arrive({ notifyLetter: true, channel: 'email' })
    const sent = ses.commandCalls(SendEmailCommand).map((c) => c.args[0].input)
    expect(sent).toHaveLength(1)
    expect(sent[0].FromEmailAddress).toBe('post@pigeon.example')
    expect(sent[0].Destination?.ToAddresses).toEqual(['b@example.com'])
    const mail = JSON.stringify(sent[0].Content)
    expect(mail).toContain('A letter arrived from Ann')
    expect(mail).not.toContain('Smith')
    expect(mail).not.toContain('secret words')
  })

  it('arrival_email_not_sent_when_no_sender_configured', async () => {
    const prev = process.env.SES_SENDER
    process.env.SES_SENDER = ''
    try {
      expect((await arrive({ notifyLetter: true, channel: 'email' })).body.delivered).toHaveLength(1)
      expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0)
    } finally {
      process.env.SES_SENDER = prev
    }
  })

  it('arrival_survives_ses_failure', async () => {
    ses.on(SendEmailCommand).rejects(new Error('SES throttled'))
    const r = await arrive({ notifyLetter: true, channel: 'email' })
    expect(r.status).toBe(200)
    expect(r.body.delivered).toEqual([expect.objectContaining({ id: 'l1', status: 'DELIVERED' })])
    expect(row('USER#b', 'LETTER#l1')!.status).toBe('DELIVERED')
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(1)
  })
})
