import type { ServerProfile, Trip } from '../../../src/lib/types'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } })
export const tableName = () => process.env.TABLE_NAME!

/** Strips the table's key attributes from an item before it goes to the client. */
export function clean<T>(item: Record<string, unknown>): T {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ...rest } = item
  return rest as T
}

/** The profile as the API returns it: the stored sign-in email (letter alerts only) never leaves the server. */
export const profileOut = (item: Record<string, unknown>): ServerProfile => {
  const { email: _e, ...p } = clean<ServerProfile & { email?: string }>(item)
  return p
}

/** A stored trip: the API contract's Trip (no `route`) plus when it was created, which picks the current trip. */
export type StoredTrip = Omit<Trip, 'route'> & { createdMs: number }
export const tripOut = ({ createdMs: _c, ...t }: StoredTrip): Omit<Trip, 'route'> => t
export const isConditionFail = (e: unknown) => (e as Error)?.name === 'ConditionalCheckFailedException'
