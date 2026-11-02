import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { ddb, tableName } from './db'
import { blockSk, userPk } from './keys'

const has = async (owner: string, other: string) => !!(await ddb.send(new GetCommand({ TableName: tableName(), Key: { PK: userPk(owner), SK: blockSk(other) }, ConsistentRead: true }))).Item

/** True when either user has blocked the other. Block rows live only in the blocker's partition, so check both. */
export async function blockedEitherWay(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([has(a, b), has(b, a)])
  return x || y
}
