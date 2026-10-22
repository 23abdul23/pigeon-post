import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Story } from '../../../src/lib/types'
import { clean, ddb, isConditionFail, tableName } from '../lib/db'
import { bad, fail, id, json, parseBody, route } from '../lib/http'
import { storySk, userPk } from '../lib/keys'

/** PUT /stories/{id}: `{ saved }` toggles a journal keepsake. */
export const handler = route(async (sub, event) => {
  const storyId = id(event.pathParameters?.id, 'story id')
  const { saved } = parseBody(event.body)
  if (typeof saved !== 'boolean') bad('invalid saved')
  try {
    const r = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: userPk(sub), SK: storySk(storyId) },
        UpdateExpression: 'SET saved = :saved',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':saved': saved },
        ReturnValues: 'ALL_NEW',
      }),
    )
    return json(200, clean<Story>(r.Attributes ?? {}))
  } catch (e) {
    if (isConditionFail(e)) return fail(404, 'story not found')
    throw e
  }
})
