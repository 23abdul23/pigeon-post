import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } })
export const tableName = () => process.env.TABLE_NAME!

/** Strips the table's key attributes from an item before it goes to the client. */
export function clean<T>(item: Record<string, unknown>): T {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ...rest } = item
  return rest as T
}
