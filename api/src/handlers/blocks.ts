import { DeleteCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda'
import { ddb, tableName } from '../lib/db'
import { bad, id, json, route } from '../lib/http'
import { blockSk, BLOCK_PREFIX, friendSk, letterSk, sentSk, userPk } from '../lib/keys'
import { queryAll, type LetterRow, type TransactItem } from '../lib/letters'

const noContent: APIGatewayProxyResultV2 = { statusCode: 204 }

/**
 * POST /blocks/{id}: blocks `id` and removes the friendship rows in both partitions in one transaction. Idempotent (an
 * unconditional put and deletes). The row exists only in the blocker's partition, so nothing reads it out to the blocked
 * person directly. They can still infer it: a new friend request to the blocker is refused (403), the friendship vanishes,
 * and their undelivered letters to the blocker disappear from their sent list. Accepted tradeoff: hiding those effects
 * would mean faking success for requests and letters that can never arrive, which is worse than a quiet, deducible block.
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
  await cancelPending(sub, other)
  return noContent
})

/**
 * Deletes both copies of every not-yet-delivered (WAITING or CARRIED) letter between the two users, in both directions.
 * My partition holds my copy of every one of these letters (my inbox from them, my sent to them) and copies are always
 * written as pairs, so listing it finds all of them. Delivered and opened letters stay. Safe to repeat: a failure
 * part-way leaves the rest findable, and POST /blocks/{id} again finishes the job.
 */
async function cancelPending(me: string, other: string) {
  const mine = [...(await queryAll<LetterRow>(userPk(me), 'LETTER#')), ...(await queryAll<LetterRow>(userPk(me), 'SENT#'))]
  const pending = mine.filter((l) => (l.status === 'WAITING' || l.status === 'CARRIED') && (l.fromId === other || l.toId === other))
  for (let i = 0; i < pending.length; i += 25) {
    const items: TransactItem[] = pending.slice(i, i + 25).flatMap((l) => [
      { Delete: { TableName: tableName(), Key: { PK: userPk(l.toId), SK: letterSk(l.id) } } },
      { Delete: { TableName: tableName(), Key: { PK: userPk(l.fromId), SK: sentSk(l.id) } } },
    ])
    await ddb.send(new TransactWriteCommand({ TransactItems: items }))
  }
}

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
