import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { ddb, tableName } from './db'
import { blockSk, userPk } from './keys'
import type { TransactItem } from './letters'

const has = async (owner: string, other: string) => !!(await ddb.send(new GetCommand({ TableName: tableName(), Key: { PK: userPk(owner), SK: blockSk(other) }, ConsistentRead: true }))).Item

/** True when either user has blocked the other. Block rows live only in the blocker's partition, so check both. */
export async function blockedEitherWay(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([has(a, b), has(b, a)])
  return x || y
}

/**
 * ConditionChecks that make a write fail if either user has blocked the other by the time the transaction runs. Callers
 * pre-check with blockedEitherWay for the answer; these close the window between that read and the write.
 */
export const noBlockChecks = (a: string, b: string): TransactItem[] =>
  [
    [b, a],
    [a, b],
  ].map(([owner, other]) => ({ ConditionCheck: { TableName: tableName(), Key: { PK: userPk(owner), SK: blockSk(other) }, ConditionExpression: 'attribute_not_exists(PK)' } }))
