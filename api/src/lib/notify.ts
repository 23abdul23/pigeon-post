import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import type { ServerProfile } from '../../../src/lib/types'
import { ddb, tableName } from './db'
import { PROFILE_SK, userPk } from './keys'

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
