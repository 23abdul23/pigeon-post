import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { Letter, ServerProfile } from '../../../src/lib/types'
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, LETTER_MAX_CHARS, MAX_ATTACHMENTS } from '../lib/constants'
import { ddb, tableName } from '../lib/db'
import { bad, fail, id, isObj, json, num, parseBody, route, str } from '../lib/http'
import { letterOut, move, type LetterRow, type StoredAttachment, type TransactItem } from '../lib/letters'
import { friendSk, letterSk, PROFILE_SK, sentSk, userPk } from '../lib/keys'

const get = async <T>(pk: string, sk: string) =>
  (await ddb.send(new GetCommand({ TableName: tableName(), Key: { PK: pk, SK: sk }, ConsistentRead: true }))).Item as T | undefined

/** Each attempt re-reads and decides; a cancelled transaction is retried, then 503 so the client outbox retries later. */
async function transact(attempt: () => Promise<{ items: TransactItem[]; result: APIGatewayProxyResultV2 } | APIGatewayProxyResultV2>) {
  for (let i = 0; i < 3; i++) {
    const r = await attempt()
    if (typeof r === 'string' || !('items' in r)) return r
    try {
      await ddb.send(new TransactWriteCommand({ TransactItems: r.items }))
      return r.result
    } catch (e) {
      if ((e as Error)?.name !== 'TransactionCanceledException') throw e
    }
  }
  return fail(503, 'letters are busy; retry')
}

function parseAttachments(sub: string, keys: unknown, meta: unknown): StoredAttachment[] {
  if (!Array.isArray(keys) || keys.length > MAX_ATTACHMENTS) bad('invalid attachmentKeys')
  const ks = keys as unknown[]
  if (meta !== undefined && (!Array.isArray(meta) || meta.length !== ks.length)) bad('invalid attachments')
  const own = new RegExp(`^letters/${sub.replace(/[^\w-]/g, '')}/[\\w-]{1,64}$`) // only the caller's own uploads
  return ks.map((key, i) => {
    if (typeof key !== 'string' || !own.test(key)) bad('invalid attachmentKeys')
    const m: Record<string, unknown> = Array.isArray(meta) && isObj(meta[i]) ? meta[i] : {}
    const type = m.type ?? 'application/octet-stream'
    if (m.type !== undefined && !ATTACHMENT_TYPES.includes(type as string)) bad('invalid attachment type')
    return { key: key as string, name: m.name === undefined ? 'attachment' : str(m.name, 200, 'attachment name'), size: m.size === undefined ? 0 : num(m.size, 0, ATTACHMENT_MAX_BYTES, 'attachment size'), type: type as string }
  })
}

/**
 * POST /letters { id, toId, text, attachmentKeys, attachments?, status }: writes the recipient's and the sender's copy in one
 * transaction. Friends only. `id` is client-generated, so a replay returns the stored letter. `attachments` (optional,
 * same order as `attachmentKeys`) carries the file name, size and type the letter shows.
 */
export const create = route(async (sub, event) => {
  const b = parseBody(event.body)
  const letterId = id(b.id, 'id')
  const toId = id(b.toId, 'toId')
  if (toId === sub) bad('you cannot write to yourself')
  if (typeof b.text !== 'string' || b.text.length > LETTER_MAX_CHARS) bad('invalid text')
  if (b.status !== 'WAITING' && b.status !== 'CARRIED') bad('invalid status')
  const attachments = parseAttachments(sub, b.attachmentKeys, b.attachments)
  const text = (b.text as string).trim()
  if (!text && !attachments.length) bad('a letter needs words or an attachment')

  return transact(async () => {
    const mine = await get<LetterRow>(userPk(sub), sentSk(letterId))
    if (mine) return json(200, letterOut(mine, sub)) // replay
    const friend = await get<{ status: string }>(userPk(sub), friendSk(toId))
    if (friend?.status !== 'accepted') return fail(403, 'letters go to friends only')
    const me = await get<ServerProfile>(userPk(sub), PROFILE_SK)
    if (!me?.name || !me.homeCity) return bad('finish setting up your profile first')
    // profile fields are whitelisted here, so an email can never ride along
    const letter: Omit<LetterRow, 'box'> = {
      id: letterId,
      fromId: sub,
      fromName: me.name,
      fromCity: me.homeCity.name,
      cc: me.homeCity.cc,
      toId,
      text,
      attachments,
      status: b.status as Letter['status'],
      dateMs: Date.now(),
    }
    const put = (PK: string, SK: string, box: LetterRow['box']): TransactItem => ({
      Put: { TableName: tableName(), Item: { PK, SK, ...letter, box }, ConditionExpression: 'attribute_not_exists(PK)' },
    })
    return { items: [put(userPk(toId), letterSk(letterId), 'in'), put(userPk(sub), sentSk(letterId), 'sent')], result: json(200, letterOut({ ...letter, box: 'sent' }, sub)) }
  })
})

/** POST /letters/{id}/open: the recipient opens a DELIVERED letter; both copies become OPENED. Anyone else: 403. */
export const open = route(async (sub, event) => {
  const letterId = id(event.pathParameters?.id, 'letter id')
  return transact(async () => {
    const l = await get<LetterRow>(userPk(sub), letterSk(letterId))
    if (!l) return fail(403, 'not your letter')
    if (l.status === 'OPENED') return json(200, letterOut(l, sub))
    if (l.status !== 'DELIVERED') return fail(409, 'this letter has not arrived yet')
    const [inbox, sent] = move(l, 'DELIVERED', 'OPENED')
    // a sender who deleted their account has no copy left to mirror
    const senderCopy = await get<LetterRow>(userPk(l.fromId), sentSk(letterId))
    return { items: senderCopy ? [inbox, sent] : [inbox], result: json(200, letterOut({ ...l, status: 'OPENED' }, sub)) }
  })
})

/** PUT /letters/{id} { saved }: a keepsake is per person, so only the caller's own copy changes. */
export const save = route(async (sub, event) => {
  const letterId = id(event.pathParameters?.id, 'letter id')
  const { saved } = parseBody(event.body)
  if (typeof saved !== 'boolean') bad('invalid saved')
  const PK = userPk(sub)
  const SK = (await get(PK, letterSk(letterId))) ? letterSk(letterId) : (await get(PK, sentSk(letterId))) ? sentSk(letterId) : fail(404, 'letter not found')
  const r = await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK, SK },
      UpdateExpression: 'SET saved = :saved',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':saved': saved },
      ReturnValues: 'ALL_NEW',
    }),
  )
  return json(200, letterOut(r.Attributes as LetterRow, sub))
})

const ROUTES: Record<string, ReturnType<typeof route>> = {
  'POST /letters': create,
  'POST /letters/{id}/open': open,
  'PUT /letters/{id}': save,
}
/** One Lambda serves the three letter routes (same IAM), dispatching on the API Gateway route key. */
export const handler = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => (ROUTES[event.routeKey] ?? (async () => json(404, { error: 'not found' })))(event)
