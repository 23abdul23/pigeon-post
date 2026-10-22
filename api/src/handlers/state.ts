import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { ServerProfile, ServerState } from '../../../src/lib/types'
import { getUserId, Unauthorized } from '../lib/auth'
import { clean, ddb, tableName } from '../lib/db'
import { json } from '../lib/http'
import { PROFILE_SK, userPk } from '../lib/keys'

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  let sub: string
  try {
    sub = getUserId(event)
  } catch (e) {
    if (e instanceof Unauthorized) return json(401, { error: 'unauthorized' })
    throw e
  }

  const s: ServerState = { profile: null, trip: null, stories: [], letters: [], friends: [], stamps: [], sessions: [] }
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await ddb.send(
      new QueryCommand({ TableName: tableName(), KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': userPk(sub) }, ExclusiveStartKey }),
    )
    for (const item of page.Items ?? []) {
      const sk = String(item.SK)
      // Later tasks dispatch their SK prefixes here (TRIP#, SESSION#, STORY#, STAMP#, FRIEND#, LETTER#, SENT#).
      if (sk === PROFILE_SK) s.profile = clean<ServerProfile>(item)
    }
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey)

  return json(200, s)
}
