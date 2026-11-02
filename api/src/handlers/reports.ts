import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import { randomUUID } from 'node:crypto'
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import type { ReportInput } from '../../../src/lib/types'
import { ddb, isConditionFail, tableName } from '../lib/db'
import { bad, fail, id, json, optStr, parseBody, route } from '../lib/http'
import { reportPk, reportUsageSk, REPORT_SK, userPk } from '../lib/keys'

const ses = new SESv2Client({})
const DAILY_CAP = 20
const DAY = 86400
const KINDS = ['user', 'letter']
const REASONS = ['spam', 'harassment', 'inappropriate', 'other']
const oneOf = <T extends string>(v: unknown, list: string[], what: string) => (typeof v === 'string' && list.includes(v) ? (v as T) : bad(`invalid ${what}`))

/**
 * POST /reports: stores a report for moderator triage and returns 204. Reports are triage input, not trusted facts, so any
 * syntactically valid target id is accepted. The optional moderator email is best effort and never fails the request.
 */
export const report = route(async (sub, event) => {
  const b = parseBody(event.body)
  const input: ReportInput = {
    targetId: id(b.targetId, 'targetId'),
    kind: oneOf(b.kind, KINDS, 'kind'),
    reason: oneOf(b.reason, REASONS, 'reason'),
    note: optStr(b.note, 500, 'note'),
    letterId: b.letterId === undefined ? undefined : id(b.letterId, 'letterId'),
  }
  // per-user daily cap (UTC day): each report costs a row and maybe an email from the shared SES sender
  const now = Math.floor(Date.now() / 1000)
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: userPk(sub), SK: reportUsageSk(new Date(now * 1000).toISOString().slice(0, 10)) },
        UpdateExpression: 'ADD n :one SET #ttl = :ttl',
        ConditionExpression: 'attribute_not_exists(n) OR n < :cap',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':cap': DAILY_CAP, ':ttl': now + 2 * DAY },
      }),
    )
  } catch (e) {
    if (isConditionFail(e)) return fail(429, 'daily limit reached')
    throw e
  }
  const reportId = randomUUID()
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: { PK: reportPk(reportId), SK: REPORT_SK, id: reportId, reporterId: sub, ...input, createdMs: Date.now() },
    }),
  )
  await notifyModerator(reportId, sub, input)
  return { statusCode: 204 }
})

async function notifyModerator(reportId: string, reporterId: string, r: ReportInput): Promise<void> {
  try {
    const To = process.env.MODERATOR_EMAIL
    const From = process.env.SES_SENDER
    if (!To || !From) return
    const body = [`Report ${reportId}`, `reporter: ${userPk(reporterId)}`, `target: ${r.kind} ${r.targetId}`, r.letterId ? `letter: ${r.letterId}` : '', `reason: ${r.reason}`, r.note ? `note: ${r.note}` : '']
      .filter(Boolean)
      .join('\n')
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: From,
        Destination: { ToAddresses: [To] },
        Content: { Simple: { Subject: { Data: `Pigeon Post report: ${r.reason} (${r.kind})` }, Body: { Text: { Data: body } } } },
      }),
    )
  } catch (e) {
    console.warn('moderator email not sent', (e as Error)?.name)
  }
}

export const handler = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => (event.routeKey === 'POST /reports' ? report(event) : Promise.resolve(json(404, { error: 'not found' })))
