import { DeleteCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda'
import { ddb, tableName } from '../lib/db'
import { bad, id, json, route } from '../lib/http'
import { blockSk, BLOCK_PREFIX, friendSk, userPk } from '../lib/keys'

const noContent: APIGatewayProxyResultV2 = { statusCode: 204 }

/**
 * POST /blocks/{id}: blocks `id` and removes the friendship rows in both partitions in one transaction. Idempotent (an
 * unconditional put and deletes). The row exists only in the blocker's partition, so the blocked person cannot learn of it.
 */
export const block = route(async (sub, event) => {
  const other = id(event.pathParameters?.id, 'user id')
  if (other === sub) bad('you cannot block yourself')
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: tableName(), Item: { PK: userPk(sub), SK: blockSk(other), id: other, createdMs: Date.now() } } },
        { Delete: { TableName: tableName(), Key: { PK: userPk(sub), SK: friendSk(other) } } },
        { Delete: { TableName: tableName(), Key: { PK: userPk(other), SK: friendSk(sub) } } },
      ],
    }),
  )
  return noContent
})

/** DELETE /blocks/{id}: unblock. Does not restore the friendship. Already gone is fine. */
export const unblock = route(async (sub, event) => {
  const other = id(event.pathParameters?.id, 'user id')
  await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: blockSk(other) } }))
  return noContent
})

/** GET /blocks: { ids } of the people I blocked. */
export const list = route(async (sub) => {
  const ids: string[] = []
  let start: Record<string, unknown> | undefined
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': userPk(sub), ':sk': BLOCK_PREFIX },
        ExclusiveStartKey: start,
      }),
    )
    for (const it of r.Items ?? []) ids.push(String(it.id))
    start = r.LastEvaluatedKey
  } while (start)
  return json(200, { ids })
})

const ROUTES: Record<string, ReturnType<typeof route>> = {
  'POST /blocks/{id}': block,
  'DELETE /blocks/{id}': unblock,
  'GET /blocks': list,
}
/** One Lambda serves the three block routes, dispatching on the API Gateway route key. */
export const handler = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => (ROUTES[event.routeKey] ?? (async () => json(404, { error: 'not found' })))(event)
