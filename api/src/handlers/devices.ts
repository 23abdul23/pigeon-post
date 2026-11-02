import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda'
import { ddb, tableName } from '../lib/db'
import { bad, json, parseBody, route } from '../lib/http'
import { DEVICE_PREFIX, deviceSk, userPk } from '../lib/keys'

const noContent: APIGatewayProxyResultV2 = { statusCode: 204 }
/** At most this many push tokens per user; a new one beyond the cap replaces the oldest (a reinstall leaves stale tokens behind). */
export const MAX_DEVICES = 10
const MAX_TOKEN = 4096

const token = (v: unknown) => (typeof v === 'string' && v.trim() && v.length <= MAX_TOKEN ? v : bad('invalid token'))

/**
 * PUT /devices { token, platform: 'android' }: stores the caller's FCM token, one row per (user, token), so a repeat is a
 * no-op that keeps the first createdMs. Over the cap the oldest row goes. The caller comes only from the JWT.
 */
export const put = route(async (sub, event) => {
  const b = parseBody(event.body)
  const t = token(b.token)
  if (b.platform !== 'android') bad('invalid platform')
  const PK = userPk(sub)
  const SK = deviceSk(t)
  const rows: { SK: string; createdMs?: number }[] = []
  let start: Record<string, unknown> | undefined
  do {
    const r = await ddb.send(
      new QueryCommand({ TableName: tableName(), KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)', ExpressionAttributeValues: { ':pk': PK, ':sk': DEVICE_PREFIX }, ExclusiveStartKey: start }),
    )
    rows.push(...((r.Items ?? []) as typeof rows))
    start = r.LastEvaluatedKey
  } while (start)
  const existing = rows.find((r) => r.SK === SK)
  if (!existing && rows.length >= MAX_DEVICES) {
    const oldest = [...rows].sort((a, c) => (a.createdMs ?? 0) - (c.createdMs ?? 0))[0]
    await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { PK, SK: oldest.SK } }))
  }
  await ddb.send(new PutCommand({ TableName: tableName(), Item: { PK, SK, token: t, platform: 'android', createdMs: existing?.createdMs ?? Date.now() } }))
  return noContent
})

/** DELETE /devices/{token}: removes the caller's own row for that token (the key holds the caller's sub). Already gone is fine. */
export const remove = route(async (sub, event) => {
  let t: string
  try {
    t = decodeURIComponent(event.pathParameters?.token ?? '')
  } catch {
    return bad('invalid token')
  }
  token(t)
  await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: deviceSk(t) } }))
  return noContent
})

const ROUTES: Record<string, ReturnType<typeof route>> = { 'PUT /devices': put, 'DELETE /devices/{token}': remove }
/** One Lambda serves both device routes, dispatching on the API Gateway route key. */
export const handler = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => (ROUTES[event.routeKey] ?? (async () => json(404, { error: 'not found' })))(event)
