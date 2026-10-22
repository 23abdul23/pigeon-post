import { QueryCommand, type TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb'
import type { Letter } from '../../../src/lib/types'
import { ddb, tableName } from './db'
import { letterSk, sentSk, userPk } from './keys'

export type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number]

/** Attachment as stored: the S3 key plus what the letter shows. */
export type StoredAttachment = { key: string; name: string; size: number; type: string }
/**
 * A letter row. The recipient's copy is `USER#<toId>/LETTER#<id>` (box=in), the sender's `USER#<fromId>/SENT#<id>` (box=sent);
 * both are always written in one transaction so their status matches. fromId/toId are Cognito subs.
 * `pickedUpBy` is the trip id of the traveler's bird that picked a WAITING letter up, so arriving home delivers exactly those.
 */
export type LetterRow = Omit<Letter, 'attachments'> & { attachments: StoredAttachment[]; box: 'in' | 'sent'; pickedUpBy?: string; PK?: string; SK?: string }

/** The client's view: its own sub reads as 'me' (src/lib/store.ts convention); key attributes and bookkeeping stay server-side. */
export function letterOut(r: LetterRow, sub: string): Letter {
  const { PK: _p, SK: _s, box: _b, pickedUpBy: _t, ...l } = r
  return { ...l, fromId: l.fromId === sub ? 'me' : l.fromId, toId: l.toId === sub ? 'me' : l.toId }
}

/** Both copies of a letter move `from` -> `to`; each write is conditional on `from`, so a replay or race cancels instead of moving twice. */
export function move(l: LetterRow, from: Letter['status'], to: Letter['status'], pickedUpBy?: string): TransactItem[] {
  const copy = (PK: string, SK: string): TransactItem => ({
    Update: {
      TableName: tableName(),
      Key: { PK, SK },
      UpdateExpression: pickedUpBy ? 'SET #s = :to, pickedUpBy = :trip' : 'SET #s = :to',
      ConditionExpression: '#s = :from',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':to': to, ':from': from, ...(pickedUpBy && { ':trip': pickedUpBy }) },
    },
  })
  return [copy(userPk(l.toId), letterSk(l.id)), copy(userPk(l.fromId), sentSk(l.id))]
}

/** Every row in `pk` whose SK starts with `prefix` (paged, consistent); an empty prefix means the whole partition. */
export async function queryAll<T>(pk: string, prefix: string): Promise<T[]> {
  const out: T[] = []
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        ConsistentRead: true,
        KeyConditionExpression: prefix ? 'PK = :pk AND begins_with(SK, :sk)' : 'PK = :pk',
        ExpressionAttributeValues: prefix ? { ':pk': pk, ':sk': prefix } : { ':pk': pk },
        ExclusiveStartKey,
      }),
    )
    out.push(...((page.Items ?? []) as T[]))
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return out
}
