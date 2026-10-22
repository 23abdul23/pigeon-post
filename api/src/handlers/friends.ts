import { GetCommand, QueryCommand, TransactWriteCommand, type TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { Friend, ServerProfile } from '../../../src/lib/types'
import { ddb, tableName } from '../lib/db'
import { bad, fail, id, json, parseBody, route, str } from '../lib/http'
import { friendSk, codePk, PROFILE_SK, userPk } from '../lib/keys'

type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number]
type Row = Friend & { PK: string; SK: string }
const noContent: APIGatewayProxyResultV2 = { statusCode: 204 }

const TableName = () => tableName()
const get = async (pk: string, sk: string) => (await ddb.send(new GetCommand({ TableName: TableName(), Key: { PK: pk, SK: sk }, ConsistentRead: true }))).Item
const friendOut = ({ PK: _p, SK: _s, ...f }: Row): Friend => f

/** A row in `owner`'s partition describing `other`. Only whitelisted profile fields are copied, so an email can never leak in. */
const rowFor = (owner: string, other: string, p: ServerProfile, status: Friend['status']): Row => ({
  PK: userPk(owner),
  SK: friendSk(other),
  id: other,
  name: p.name!,
  city: p.homeCity!.name,
  cc: p.homeCity!.cc,
  lat: p.homeCity!.lat, // already rounded to 2 decimals by PUT /me
  lng: p.homeCity!.lng,
  status,
})

/**
 * Mirrored writes touch two partitions, so they go in one transaction. Each attempt re-reads and decides; a cancelled
 * transaction (a concurrent change to either row, throttling) is retried, then 503 so the client outbox retries later.
 */
async function mirrored(attempt: () => Promise<{ items: TransactItem[]; result: APIGatewayProxyResultV2 } | APIGatewayProxyResultV2>) {
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
  return fail(503, 'friends are busy; retry')
}

const put = (Item: Row, from?: Friend['status']): TransactItem => ({
  Put: {
    TableName: TableName(),
    Item,
    ...(from ? { ConditionExpression: '#s = :from', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':from': from } } : { ConditionExpression: 'attribute_not_exists(PK)' }),
  },
})
const del = (owner: string, other: string, from?: Friend['status']): TransactItem => ({
  Delete: {
    TableName: TableName(),
    Key: { PK: userPk(owner), SK: friendSk(other) },
    ...(from && { ConditionExpression: '#s = :from', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':from': from } }),
  },
})

const accepted = (mine: Row, theirs: Row): TransactItem[] => [
  put({ ...mine, status: 'accepted' }, 'pending_in'),
  put({ ...theirs, status: 'accepted' }, 'pending_out'),
]

/** POST /friends/request { code }: invite codes are typed by hand, so case, spaces and dashes are ignored. */
export const request = route(async (sub, event) => {
  const code = str(parseBody(event.body).code, 40, 'code').replace(/[^a-z0-9]/gi, '').toUpperCase()
  if (!code) bad('invalid code')

  // Codes are not guaranteed unique across users (8 random chars). More than one owner: refuse rather than guess.
  const hits = (
    await ddb.send(new QueryCommand({ TableName: TableName(), IndexName: 'GSI1', KeyConditionExpression: 'GSI1PK = :pk', ExpressionAttributeValues: { ':pk': codePk(code) }, Limit: 2 }))
  ).Items
  if (!hits?.length) return fail(404, 'no one has that code')
  if (hits.length > 1) return fail(409, 'that code is ambiguous; ask your friend to check it')
  const other = String(hits[0].GSI1SK).replace(/^USER#/, '')
  if (other === sub) return bad('that is your own code')

  return mirrored(async () => {
    const them = (await get(userPk(other), PROFILE_SK)) as ServerProfile | undefined
    // a friend who has not finished onboarding has no name/home city to show: same as an unknown code
    if (!them?.name || !them.homeCity) return fail(404, 'no one has that code')
    const mine = (await get(userPk(sub), friendSk(other))) as Row | undefined
    const theirRow = (await get(userPk(other), friendSk(sub))) as Row | undefined
    if (mine?.status === 'pending_out' || mine?.status === 'accepted') return json(200, friendOut(mine)) // idempotent
    if (mine?.status === 'pending_in' && theirRow) return { items: accepted(mine, theirRow), result: json(200, friendOut({ ...mine, status: 'accepted' })) } // they already asked me
    const me = (await get(userPk(sub), PROFILE_SK)) as ServerProfile | undefined
    if (!me?.name || !me.homeCity) return bad('finish setting up your profile first')
    const out = rowFor(sub, other, them, 'pending_out')
    return { items: [put(out), put(rowFor(other, sub, me, 'pending_in'))], result: json(200, friendOut(out)) }
  })
})

/** POST /friends/{id}/accept: only the receiver of a pending request can accept it. */
export const accept = route(async (sub, event) => {
  const other = id(event.pathParameters?.id, 'friend id')
  return mirrored(async () => {
    const mine = (await get(userPk(sub), friendSk(other))) as Row | undefined
    if (!mine) return fail(404, 'no such request')
    if (mine.status === 'accepted') return json(200, friendOut(mine))
    if (mine.status === 'pending_out') return fail(409, 'you sent this request; they have to accept it')
    const theirs = (await get(userPk(other), friendSk(sub))) as Row | undefined
    if (!theirs) return fail(404, 'no such request')
    return { items: accepted(mine, theirs), result: json(200, friendOut({ ...mine, status: 'accepted' })) }
  })
})

/** POST /friends/{id}/decline: drops a pending request on both sides. Already gone is fine; an accepted friend is not declined. */
export const decline = route(async (sub, event) => {
  const other = id(event.pathParameters?.id, 'friend id')
  return mirrored(async () => {
    const mine = (await get(userPk(sub), friendSk(other))) as Row | undefined
    if (!mine) return noContent
    if (mine.status !== 'pending_in') return fail(409, 'only a request sent to you can be declined')
    return { items: [del(sub, other, 'pending_in'), del(other, sub)], result: noContent }
  })
})

/** DELETE /friends/{id}: unfriend, or cancel a request I sent. Removes both rows. */
export const remove = route(async (sub, event) => {
  const other = id(event.pathParameters?.id, 'friend id')
  return mirrored(async () => ({ items: [del(sub, other), del(other, sub)], result: noContent }))
})

const ROUTES: Record<string, ReturnType<typeof route>> = {
  'POST /friends/request': request,
  'POST /friends/{id}/accept': accept,
  'POST /friends/{id}/decline': decline,
  'DELETE /friends/{id}': remove,
}
/** One Lambda serves all four friend routes (same IAM), dispatching on the API Gateway route key. */
export const handler = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => (ROUTES[event.routeKey] ?? (async () => json(404, { error: 'not found' })))(event)
