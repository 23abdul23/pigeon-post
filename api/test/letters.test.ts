import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { handler as letters } from '../src/handlers/letters'
import { handler as uploads } from '../src/handlers/uploads'
import { handler as postSession } from '../src/handlers/sessions'
import { returnTrip } from '../src/handlers/trips'
import { handler as state } from '../src/handlers/state'

process.env.TABLE_NAME = 'PigeonPostTest'
process.env.LETTERS_BUCKET = 'letters-test-bucket'
process.env.AWS_REGION = 'us-east-1'
process.env.AWS_ACCESS_KEY_ID = 'AKIATEST'
process.env.AWS_SECRET_ACCESS_KEY = 'secret'
const ddb = mockClient(DynamoDBDocumentClient)

// In-memory table: Get, Query (PK [+ begins_with SK]), Update and Transact (Put/Update) with simple
// `a = :v AND attribute_exists(PK)` style conditions, like DynamoDB.
const table = new Map<string, Record<string, any>>()
const k = (pk: unknown, sk: unknown) => `${pk}|${sk}`
const row = (pk: string, sk: string) => table.get(k(pk, sk))

const name = (op: any, n: string) => (n.startsWith('#') ? op.ExpressionAttributeNames[n] : n)
function holds(op: any, item: Record<string, any> | undefined) {
  if (!op.ConditionExpression) return true
  return (op.ConditionExpression as string).split(' AND ').every((c) => {
    if (c === 'attribute_not_exists(PK)') return !item
    if (c === 'attribute_exists(PK)') return !!item
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
const cancelled = () => new TransactionCanceledException({ message: 'cancelled', $metadata: {} })

const ev = (o: { sub?: string; routeKey?: string; body?: unknown; id?: string; query?: Record<string, string> }) =>
  ({
    routeKey: o.routeKey,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    pathParameters: o.id ? { id: o.id } : undefined,
    queryStringParameters: o.query,
    requestContext: { authorizer: { jwt: { claims: { sub: o.sub ?? 'a' }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
const call = async (h: (e: APIGatewayProxyEventV2WithJWTAuthorizer) => Promise<unknown>, e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = (await h(e)) as APIGatewayProxyStructuredResultV2
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }
}
const transacts = () => ddb.commandCalls(TransactWriteCommand)

const city = (n: string, cc: string) => ({ name: n, country: cc, cc, lat: 1, lng: 2 })
const profile = (sub: string, n: string, home: ReturnType<typeof city>) =>
  table.set(k(`USER#${sub}`, 'PROFILE'), { PK: `USER#${sub}`, SK: 'PROFILE', inviteCode: sub.toUpperCase().repeat(8), name: n, homeCity: home, email: `${sub}@example.com` })
const friends = (x: string, y: string, status = 'accepted') => {
  table.set(k(`USER#${x}`, `FRIEND#${y}`), { PK: `USER#${x}`, SK: `FRIEND#${y}`, id: y, status })
  table.set(k(`USER#${y}`, `FRIEND#${x}`), { PK: `USER#${y}`, SK: `FRIEND#${x}`, id: x, status })
}

const write = (sub: string, body: Record<string, unknown>) =>
  call(letters, ev({ sub, routeKey: 'POST /letters', body: { id: 'l1', toId: 'b', text: 'Hello from Zagreb', attachmentKeys: [], status: 'CARRIED', ...body } }))
const open = (sub: string, id: string) => call(letters, ev({ sub, routeKey: 'POST /letters/{id}/open', id }))
const presign = (body: unknown, sub = 'a') => call(uploads, ev({ sub, routeKey: 'POST /uploads/presign', body }))
const downloadUrl = (key: string, sub = 'a') => call(uploads, ev({ sub, routeKey: 'GET /uploads/url', query: { key } }))

const seedTrip = (sub: string, over: Record<string, unknown> = {}) =>
  table.set(k(`USER#${sub}`, 'TRIP#t1'), {
    PK: `USER#${sub}`,
    SK: 'TRIP#t1',
    id: 't1',
    dest: { id: 'p', name: 'Kyoto', country: 'JP', cc: 'JP', lat: 1, lng: 2 },
    routeKm: 1000,
    progressKm: 900,
    status: 'OUTBOUND',
    legs: 3,
    friendId: 'b',
    letterIds: ['l1'],
    createdMs: 1,
    ...over,
  })
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
const status = (pk: string, sk: string) => row(pk, sk)?.status

beforeEach(() => {
  ddb.reset()
  table.clear()
  profile('a', 'Ann', city('Zagreb', 'HR'))
  profile('b', 'Bob', city('Kyoto', 'JP'))
  profile('c', 'Cy', city('Oslo', 'NO'))
  friends('a', 'b')
  ddb.on(GetCommand).callsFake((i) => ({ Item: table.get(k(i.Key.PK, i.Key.SK)) }))
  ddb.on(QueryCommand).callsFake((i) => {
    const prefix = i.ExpressionAttributeValues[':sk'] ?? ''
    return { Items: [...table.values()].filter((r) => r.PK === i.ExpressionAttributeValues[':pk'] && String(r.SK).startsWith(prefix)) }
  })
  ddb.on(UpdateCommand).callsFake((i) => {
    if (!holds(i, table.get(k(i.Key.PK, i.Key.SK)))) throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' })
    return { Attributes: applyUpdate(i) }
  })
  ddb.on(TransactWriteCommand).callsFake((i) => {
    const items = i.TransactItems as any[]
    if (items.some((t) => (t.Put ? !holds(t.Put, table.get(k(t.Put.Item.PK, t.Put.Item.SK))) : !holds(t.Update, table.get(k(t.Update.Key.PK, t.Update.Key.SK)))))) throw cancelled()
    for (const t of items) t.Put ? table.set(k(t.Put.Item.PK, t.Put.Item.SK), t.Put.Item) : applyUpdate(t.Update)
    return {}
  })
})

describe('uploads', () => {
  it('presign_rejects_files_over_5mb', async () => {
    expect((await presign({ contentType: 'image/png', size: 5 * 1024 * 1024 + 1 })).status).toBe(400)
    expect((await presign({ contentType: 'image/png', size: 0 })).status).toBe(400)
    const ok = await presign({ contentType: 'application/pdf', size: 5 * 1024 * 1024 })
    expect(ok.status).toBe(200)
    expect(ok.body.key).toMatch(/^letters\/a\/[\w-]+$/)
    expect(ok.body.url).toContain('letters-test-bucket')
    expect(ok.body.url).toContain(encodeURIComponent(ok.body.key).replace(/%2F/g, '/'))
    expect(ok.body.url).toMatch(/X-Amz-SignedHeaders=[^&]*content-length/) // S3 refuses a body of another size
  })

  it('presign_rejects_exe_content_type', async () => {
    for (const contentType of ['application/x-msdownload', 'application/octet-stream', 'image/svg+xml', '', undefined])
      expect((await presign({ contentType, size: 1000 })).status).toBe(400)
  })

  it('download_url_only_for_own_or_received_attachments', async () => {
    expect((await downloadUrl('letters/a/k1')).status).toBe(200)
    expect((await downloadUrl('letters/a/k1', 'b')).status).toBe(403) // not on any letter Bob has received yet
    await write('a', { attachmentKeys: ['letters/a/k1'], attachments: [{ name: 'cv.pdf', size: 1000, type: 'application/pdf' }] })
    expect((await downloadUrl('letters/a/k1', 'b')).status).toBe(403) // still in the air
    row('USER#b', 'LETTER#l1')!.status = 'DELIVERED'
    const r = await downloadUrl('letters/a/k1', 'b')
    expect(r.status).toBe(200)
    expect(r.body.url).toContain('letters/a/k1')
    expect((await downloadUrl('letters/a/k1', 'c')).status).toBe(403)
    expect((await downloadUrl('site/index.html')).status).toBe(400)
    expect((await downloadUrl('letters/a/../b/k1')).status).toBe(400)
  })
})

describe('POST /letters', () => {
  it('letter_to_non_friend_is_rejected', async () => {
    expect((await write('a', { toId: 'c' })).status).toBe(403)
    friends('a', 'c', 'pending_out')
    expect((await write('a', { toId: 'c' })).status).toBe(403)
    expect((await write('a', { toId: 'a' })).status).toBe(400)
    expect(transacts()).toHaveLength(0)
  })

  it('letter_text_over_2000_chars_is_rejected', async () => {
    expect((await write('a', { text: 'x'.repeat(2001) })).status).toBe(400)
    expect((await write('a', { status: 'DELIVERED' })).status).toBe(400)
    expect((await write('a', { attachmentKeys: ['letters/b/k1'] })).status).toBe(400) // someone else's upload
    expect((await write('a', { attachmentKeys: ['letters/a/1', 'letters/a/2', 'letters/a/3', 'letters/a/4'] })).status).toBe(400)
    expect(transacts()).toHaveLength(0)

    const ok = await write('a', { text: 'x'.repeat(2000) })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ id: 'l1', fromId: 'me', toId: 'b', fromName: 'Ann', fromCity: 'Zagreb', cc: 'HR', status: 'CARRIED', attachments: [] })
    expect(row('USER#b', 'LETTER#l1')).toMatchObject({ box: 'in', fromId: 'a', toId: 'b', status: 'CARRIED' })
    expect(row('USER#a', 'SENT#l1')).toMatchObject({ box: 'sent', fromId: 'a', toId: 'b', status: 'CARRIED' })
    expect(JSON.stringify([...table.values()].filter((r) => String(r.SK).match(/LETTER|SENT/)))).not.toContain('@example.com')
    expect(await write('a', { text: 'x'.repeat(2000) })).toEqual(ok) // replay of the same id
  })
})

describe('arrival', () => {
  it('arrival_delivers_sender_letters', async () => {
    await write('a', {})
    seedTrip('a')
    const r = await fly('a', 's1')
    expect(r.status).toBe(200)
    expect(r.body.trip.status).toBe('DELIVERED')
    expect(r.body.delivered).toEqual([expect.objectContaining({ id: 'l1', fromId: 'me', toId: 'b', status: 'DELIVERED' })])
    expect(r.body.pickedUp).toEqual([])
    expect(status('USER#a', 'SENT#l1')).toBe('DELIVERED')
    expect(status('USER#b', 'LETTER#l1')).toBe('DELIVERED')
    const bob = await call(state, ev({ sub: 'b' }))
    expect(bob.body.letters).toEqual([expect.objectContaining({ id: 'l1', fromId: 'a', toId: 'me', fromName: 'Ann', status: 'DELIVERED' })])
    expect(bob.body.letters[0].box).toBeUndefined()
  })

  it('arrival_loads_friend_waiting_letters_onto_return_trip', async () => {
    await write('b', { id: 'reply', toId: 'a', text: 'Write back soon', status: 'WAITING' })
    await write('b', { id: 'bobs-own', toId: 'a', text: 'On my own bird', status: 'CARRIED' }) // Bob's bird carries this one
    seedTrip('a')
    const r = await fly('a', 's1')
    expect(r.body.pickedUp).toEqual([expect.objectContaining({ id: 'reply', fromId: 'b', toId: 'me', status: 'CARRIED' })])
    expect(status('USER#a', 'LETTER#reply')).toBe('CARRIED')
    expect(status('USER#b', 'SENT#reply')).toBe('CARRIED')

    expect((await call(returnTrip, ev({ sub: 'a', id: 't1' }))).body.status).toBe('RETURNING')
    table.get(k('USER#a', 'TRIP#t1'))!.progressKm = 900
    const home = await fly('a', 's2')
    expect(home.body.trip.status).toBe('DONE')
    expect(home.body.delivered).toEqual([expect.objectContaining({ id: 'reply', status: 'DELIVERED' })])
    expect(status('USER#a', 'LETTER#reply')).toBe('DELIVERED')
    expect(status('USER#b', 'SENT#reply')).toBe('DELIVERED')
    expect(status('USER#a', 'LETTER#bobs-own')).toBe('CARRIED') // not on Ann's bird
  })

  it('arrival_twice_does_not_duplicate_or_redeliver', async () => {
    await write('a', {})
    await write('b', { id: 'reply', toId: 'a', status: 'WAITING' })
    seedTrip('a')
    const first = await fly('a', 's1')
    const rows = table.size
    const sent = transacts().length
    expect(await fly('a', 's1')).toEqual(first) // replay
    expect(transacts()).toHaveLength(sent)

    await write('b', { id: 'late', toId: 'a', status: 'WAITING' }) // written after the bird left Bob's city
    const again = await fly('a', 's2') // another session on the already-arrived trip
    expect(again.body).toMatchObject({ delivered: [], pickedUp: [] })
    expect(status('USER#a', 'LETTER#late')).toBe('WAITING')
    expect(status('USER#a', 'LETTER#reply')).toBe('CARRIED')
    expect(status('USER#b', 'LETTER#l1')).toBe('DELIVERED')
    expect(table.size).toBe(rows + 2 /* late */ + 2 /* s2 session + story */)
    // every letter write is conditional on the status it moves from
    for (const t of transacts()[sent - 1].args[0].input.TransactItems!.filter((x) => x.Update))
      expect(t.Update!.ConditionExpression).toBe('#s = :from')
  })
})

describe('open and save', () => {
  it('open_letter_by_non_recipient_is_403', async () => {
    await write('a', {})
    expect((await open('b', 'l1')).status).toBe(409) // still in the air
    row('USER#b', 'LETTER#l1')!.status = 'DELIVERED'
    row('USER#a', 'SENT#l1')!.status = 'DELIVERED'
    expect((await open('c', 'l1')).status).toBe(403)
    expect((await open('a', 'l1')).status).toBe(403) // the sender cannot open it for them
    const r = await open('b', 'l1')
    expect(r.body).toMatchObject({ id: 'l1', toId: 'me', status: 'OPENED' })
    expect(status('USER#a', 'SENT#l1')).toBe('OPENED')
    expect(await open('b', 'l1')).toEqual(r)

    const saved = await call(letters, ev({ sub: 'b', routeKey: 'PUT /letters/{id}', id: 'l1', body: { saved: true } }))
    expect(saved.body).toMatchObject({ id: 'l1', saved: true })
    expect(row('USER#a', 'SENT#l1')!.saved).toBeUndefined() // a keepsake is per person
    expect((await call(letters, ev({ sub: 'c', routeKey: 'PUT /letters/{id}', id: 'l1', body: { saved: true } }))).status).toBe(404)
  })
})
