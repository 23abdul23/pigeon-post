import { createSign } from 'node:crypto'
import { DeleteCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import type { ServerProfile } from '../../../src/lib/types'
import { ddb, tableName } from './db'
import { DEVICE_PREFIX, PROFILE_SK, userPk } from './keys'

const ses = new SESv2Client({})

/** "Ann" from "Ann Smith", keeping only name characters: it goes into an email. */
export const firstName = (name: string) => (name.trim().split(/\s+/)[0] ?? '').replace(/[^\p{L}\p{M}'.-]/gu, '').slice(0, 40) || 'a friend'

/**
 * Emails "A letter arrived" to `toId` when they chose letter alerts by email. Never the letter itself, only the sender's
 * first name. Best effort: a failure is logged and never reaches the request.
 */
export async function notifyLetterArrived(toId: string, fromName: string): Promise<void> {
  try {
    const p = (await ddb.send(new GetCommand({ TableName: tableName(), Key: { PK: userPk(toId), SK: PROFILE_SK } }))).Item as (ServerProfile & { email?: string }) | undefined
    const From = process.env.SES_SENDER
    if (!p?.settings?.notifyLetter || p.settings.channel !== 'email' || typeof p.email !== 'string' || !From) return
    const line = `A letter arrived from ${firstName(fromName)}.`
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: From,
        Destination: { ToAddresses: [p.email] },
        Content: { Simple: { Subject: { Data: line }, Body: { Text: { Data: `${line}\n\nOpen Pigeon Post to read it.` } } } },
      }),
    )
  } catch (e) {
    console.warn('letter email not sent', (e as Error)?.name)
  }
}

// ---- Push (Firebase Cloud Messaging HTTP v1) ----

const secrets = new SecretsManagerClient({})
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FETCH_MS = 4000
/** Overall budget for a push attempt, so a slow Google never holds the letter response past the Lambda timeout. */
const PUSH_BUDGET_MS = 5000
const REFRESH_MARGIN_MS = 5 * 60_000

type ServiceAccount = { project_id: string; client_email: string; private_key: string }
let account: ServiceAccount | undefined
let access: { token: string; expiresMs: number } | undefined
/** Forgets the cached service account and access token (tests). */
export const resetFcmCache = () => {
  account = undefined
  access = undefined
}

async function serviceAccount(arn: string): Promise<ServiceAccount> {
  if (account) return account
  const r = await secrets.send(new GetSecretValueCommand({ SecretId: arn }))
  const v = JSON.parse(r.SecretString ?? '') as Partial<ServiceAccount>
  if (typeof v.project_id !== 'string' || typeof v.client_email !== 'string' || typeof v.private_key !== 'string') throw Object.assign(new Error('bad service account'), { name: 'BadServiceAccount' })
  return (account = { project_id: v.project_id, client_email: v.client_email, private_key: v.private_key })
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

/** An OAuth2 access token from a self-signed RS256 JWT (the service-account flow), cached until five minutes before it expires. */
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (access && Date.now() < access.expiresMs - REFRESH_MARGIN_MS) return access.token
  const iat = Math.floor(Date.now() / 1000)
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`
  const assertion = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url')}`
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    signal: AbortSignal.timeout(FETCH_MS),
  })
  if (!res.ok) throw Object.assign(new Error(`token endpoint ${res.status}`), { name: 'FcmTokenError' })
  const j = (await res.json()) as { access_token?: string; expires_in?: number }
  if (typeof j.access_token !== 'string') throw Object.assign(new Error('no access token'), { name: 'FcmTokenError' })
  access = { token: j.access_token, expiresMs: Date.now() + (typeof j.expires_in === 'number' ? j.expires_in : 3600) * 1000 }
  return access.token
}

/** True when FCM says this token will never work again, so its row should go. */
async function isStale(res: Response): Promise<boolean> {
  if (res.status === 404 || res.status === 410) return true
  try {
    const e = ((await res.json()) as { error?: { status?: string; details?: { errorCode?: string }[] } }).error
    // INVALID_ARGUMENT is NOT here: a payload bug or wrong project must never wipe valid tokens
    return e?.status === 'UNREGISTERED' || !!e?.details?.some((d) => d.errorCode === 'UNREGISTERED')
  } catch {
    return false
  }
}

/** Sends "A letter arrived" to one device; drops the row when FCM reports the token dead. Never the letter, only the sender's first name. */
async function sendOne(sa: ServiceAccount, bearer: string, toId: string, row: { SK: string; token: string }, from: string) {
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: row.token,
          notification: { title: 'A letter arrived', body: `${from} sent you a letter` },
          data: { type: 'letter' },
          android: { notification: { channel_id: 'letters' } },
        },
      }),
      signal: AbortSignal.timeout(FETCH_MS),
    })
    if (res.ok) return
    if (await isStale(res)) await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { PK: userPk(toId), SK: row.SK } }))
    else console.warn('letter push not sent', res.status)
  } catch (e) {
    console.warn('letter push not sent', (e as Error)?.name)
  }
}

async function pushLetter(toId: string, fromName: string): Promise<void> {
  const arn = process.env.FCM_SECRET_ARN
  if (!arn) return
  const p = (await ddb.send(new GetCommand({ TableName: tableName(), Key: { PK: userPk(toId), SK: PROFILE_SK } }))).Item as ServerProfile | undefined
  // push is for everyone who wants letter alerts and did not pick email only
  if (!p?.settings?.notifyLetter || p.settings.channel === 'email') return
  const rows: { SK: string; token: string }[] = []
  let start: Record<string, unknown> | undefined
  do {
    const r = await ddb.send(
      new QueryCommand({ TableName: tableName(), KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)', ExpressionAttributeValues: { ':pk': userPk(toId), ':sk': DEVICE_PREFIX }, ExclusiveStartKey: start }),
    )
    rows.push(...((r.Items ?? []) as typeof rows).filter((i) => typeof i.token === 'string'))
    start = r.LastEvaluatedKey
  } while (start)
  if (!rows.length) return
  const sa = await serviceAccount(arn)
  const bearer = await accessToken(sa)
  const from = firstName(fromName)
  await Promise.all(rows.map((row) => sendOne(sa, bearer, toId, row, from)))
}

/**
 * Pushes "A letter arrived" to every device `toUserId` registered, when they want letter alerts and have not chosen email
 * only. Skipped silently when no FCM secret is configured. Best effort: any failure is logged by error name only (never a
 * token, secret or response body) and never reaches the request; the whole attempt is bounded by a timeout.
 */
export async function notifyLetterDelivered(toUserId: string, fromName: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([pushLetter(toUserId, fromName), new Promise<void>((resolve) => (timer = setTimeout(resolve, PUSH_BUDGET_MS)))])
  } catch (e) {
    console.warn('letter push not sent', (e as Error)?.name)
  } finally {
    clearTimeout(timer)
  }
}
