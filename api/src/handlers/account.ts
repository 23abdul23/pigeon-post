import { BatchWriteCommand, DeleteCommand, UpdateCommand, type BatchWriteCommandInput } from '@aws-sdk/lib-dynamodb'
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { AdminDeleteUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import { ddb, isConditionFail, tableName } from '../lib/db'
import { route } from '../lib/http'
import { friendSk, letterSk, PROFILE_SK, sentSk, userPk } from '../lib/keys'
import { queryAll, type LetterRow } from '../lib/letters'

const s3 = new S3Client({})
const cognito = new CognitoIdentityProviderClient({})

type Row = Partial<Omit<LetterRow, 'status'>> & { PK: string; SK: string; status?: string } // a letter or a friend row
// a row that is already gone (or a letter that landed meanwhile) is fine: that is what a re-run sees
const unlessGone = async (write: () => Promise<unknown>) => {
  try {
    await write()
  } catch (e) {
    if (!isConditionFail(e)) throw e
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * DELETE /me: removes the account. Ordered so a failure part-way can simply be run again: first the rows I left on other
 * accounts, then my attachments, then my own rows, the profile (and with it the GSI1 invite-code entry), and the Cognito
 * user last.
 */
export const handler = route(async (sub, event) => {
  const TableName = tableName()
  const rows = await queryAll<Row>(userPk(sub), '')

  // 1. Other accounts. My friends see me as removed (a pending request just disappears). Letters still in the air to or
  //    from me lose both copies: a lone copy would never move again. Delivered letters stay in the other person's box.
  //    Friend rows go first: letters need an accepted friend, so no new letter reaches me meanwhile.
  await Promise.all(
    rows.map((r) => {
      if (r.SK.startsWith('FRIEND#')) {
        const Key = { PK: userPk(r.SK.slice('FRIEND#'.length)), SK: friendSk(sub) }
        return unlessGone(() =>
          r.status === 'accepted'
            ? ddb.send(new UpdateCommand({ TableName, Key, UpdateExpression: 'SET #s = :removed', ConditionExpression: 'attribute_exists(PK)', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':removed': 'removed' } }))
            : ddb.send(new DeleteCommand({ TableName, Key })),
        )
      }
      const inbox = r.SK.startsWith('LETTER#')
      if ((inbox || r.SK.startsWith('SENT#')) && (r.status === 'WAITING' || r.status === 'CARRIED') && r.fromId && r.toId && r.id) {
        const Key = inbox ? { PK: userPk(r.fromId), SK: sentSk(r.id) } : { PK: userPk(r.toId), SK: letterSk(r.id) }
        return unlessGone(() =>
          ddb.send(new DeleteCommand({ TableName, Key, ConditionExpression: '#s IN (:w, :c)', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':w': 'WAITING', ':c': 'CARRIED' } })),
        )
      }
    }),
  )

  // 2. My attachments. A list page holds at most 1000 keys, which is also the DeleteObjects limit.
  const Bucket = process.env.LETTERS_BUCKET
  let ContinuationToken: string | undefined
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: `letters/${sub}/`, ContinuationToken }))
    const Objects = (page.Contents ?? []).map(({ Key }) => ({ Key }))
    if (Objects.length) {
      const res = await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects, Quiet: true } }))
      if (res.Errors?.length) throw new Error(`could not delete ${res.Errors.length} attachments`)
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (ContinuationToken)

  // 3. My own rows, 25 per batch; unprocessed ones are retried with backoff, then the request fails and can be re-run.
  const deletes = rows.filter((r) => r.SK !== PROFILE_SK).map(({ PK, SK }) => ({ DeleteRequest: { Key: { PK, SK } } }))
  for (let i = 0; i < deletes.length; i += 25) {
    let RequestItems: BatchWriteCommandInput['RequestItems'] = { [TableName]: deletes.slice(i, i + 25) }
    for (let attempt = 0; RequestItems?.[TableName]?.length; attempt++) {
      if (attempt === 5) throw new Error('could not delete every row; retry')
      if (attempt) await sleep(50 * 2 ** attempt)
      RequestItems = (await ddb.send(new BatchWriteCommand({ RequestItems }))).UnprocessedItems
    }
  }

  // 4. The profile (its GSI1 keys live on it, so the invite code stops resolving), then the sign-in itself.
  //    A Cognito failure after this leaves an empty account that can sign in and delete again.
  await ddb.send(new DeleteCommand({ TableName, Key: { PK: userPk(sub), SK: PROFILE_SK } }))
  const username = event.requestContext.authorizer.jwt.claims['cognito:username'] // Google users are `google_<id>`, not their sub
  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: typeof username === 'string' ? username : sub }))
  } catch (e) {
    if ((e as Error)?.name !== 'UserNotFoundException') throw e
  }
  return { statusCode: 204 }
})
