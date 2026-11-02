import { DeleteCommand, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda'
import { type TransactItem } from '../lib/letters'
import { ddb, isConditionFail, tableName } from '../lib/db'
import { bad, fail, json, parseBody, route } from '../lib/http'
import { DEVICE_PREFIX, deviceSk, TOKEN_OWNER_SK, tokenPk, userPk } from '../lib/keys'

const noContent: APIGatewayProxyResultV2 = { statusCode: 204 }
/** At most this many push tokens per user; a new one beyond the cap replaces the oldest (a reinstall leaves stale tokens behind). */
export const MAX_DEVICES = 10
const MAX_TOKEN = 4096

const token = (v: unknown) => (typeof v === 'string' && v.trim() && v.length <= MAX_TOKEN ? v : bad('invalid token'))

/**
 * PUT /devices { token, platform: 'android' }: stores the caller's FCM token, one row per (user, token), so a repeat is a
 * no-op that keeps the first createdMs. A token has ONE owner: a global PUSHTOKEN#<hash> row names it, and claiming a token
 * another account held removes that account's DEVICE# row in the same transaction (a shared phone alerts the signed-in
 * account only). Over the cap the oldest row goes. The caller comes only from the JWT.
 */
export const put = route(async (sub, event) => {
  const b = parseBody(event.body)
  const t = token(b.token)
  if (b.platform !== 'android') bad('invalid platform')
  const PK = userPk(sub)
  const SK = deviceSk(t)
  const TableName = tableName()
  // a concurrent claim of the same token cancels the transaction; re-read and try again
  for (let attempt = 0; attempt < 3; attempt++) {
    const prev = (await ddb.send(new GetCommand({ TableName, Key: { PK: tokenPk(t), SK: TOKEN_OWNER_SK }, ConsistentRead: true }))).Item as { ownerId?: string } | undefined
    const rows: { SK: string; createdMs?: number }[] = []
    let start: Record<string, unknown> | undefined
    do {
      const r = await ddb.send(
        new QueryCommand({ TableName, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)', ExpressionAttributeValues: { ':pk': PK, ':sk': DEVICE_PREFIX }, ExclusiveStartKey: start }),
      )
      rows.push(...((r.Items ?? []) as typeof rows))
      start = r.LastEvaluatedKey
    } while (start)
    const existing = rows.find((r) => r.SK === SK)
    const items: TransactItem[] = []
    if (prev?.ownerId && prev.ownerId !== sub) items.push({ Delete: { TableName, Key: { PK: userPk(prev.ownerId), SK } } })
    if (!existing && rows.length >= MAX_DEVICES) {
      const oldest = [...rows].sort((a, c) => (a.createdMs ?? 0) - (c.createdMs ?? 0))[0]
      items.push({ Delete: { TableName, Key: { PK, SK: oldest.SK } } })
    }
    items.push(
      {
        Put: {
          TableName,
          Item: { PK: tokenPk(t), SK: TOKEN_OWNER_SK, ownerId: sub },
          ...(prev ? { ConditionExpression: 'ownerId = :prev', ExpressionAttributeValues: { ':prev': prev.ownerId } } : { ConditionExpression: 'attribute_not_exists(PK)' }),
        },
      },
      { Put: { TableName, Item: { PK, SK, token: t, platform: 'android', createdMs: existing?.createdMs ?? Date.now() } } },
    )
    try {
      await ddb.send(new TransactWriteCommand({ TransactItems: items }))
      return noContent
    } catch (e) {
      if ((e as Error)?.name !== 'TransactionCanceledException') throw e
    }
  }
  return fail(503, 'device is busy; retry')
})

/** DELETE /devices/{token}: removes the caller's own row for that token (the key holds the caller's sub), and the ownership row only while the caller still owns it. Already gone is fine. */
export const remove = route(async (sub, event) => {
  let t: string
  try {
    t = decodeURIComponent(event.pathParameters?.token ?? '')
  } catch {
    return bad('invalid token')
  }
  token(t)
  await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: deviceSk(t) } }))
  try {
    await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { PK: tokenPk(t), SK: TOKEN_OWNER_SK }, ConditionExpression: 'ownerId = :me', ExpressionAttributeValues: { ':me': sub } }))
  } catch (e) {
    if (!isConditionFail(e)) throw e // someone else owns it now (or nobody): leave it
  }
  return noContent
})

const ROUTES: Record<string, ReturnType<typeof route>> = { 'PUT /devices': put, 'DELETE /devices/{token}': remove }
/** One Lambda serves both device routes, dispatching on the API Gateway route key. */
export const handler = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => (ROUTES[event.routeKey] ?? (async () => json(404, { error: 'not found' })))(event)
