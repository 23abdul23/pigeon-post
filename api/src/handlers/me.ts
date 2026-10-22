import { randomInt } from 'node:crypto'
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Bird, City, Settings } from '../../../src/lib/types'
import { BIRD_IDS, roundCoord } from '../lib/constants'
import { ddb, profileOut, tableName } from '../lib/db'
import { bad, cc, fail, isObj, json, num, parseBody, route, str } from '../lib/http'
import { codePk, PROFILE_SK, userPk } from '../lib/keys'

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789'
const newInviteCode = () => Array.from({ length: 8 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('')

const bool = (v: unknown) => typeof v === 'boolean'

// Typed against Settings so a new client setting fails to compile until it is allowed here.
const SETTINGS: { [K in keyof Settings]: (v: unknown) => boolean } = {
  bio: (v) => typeof v === 'string' && v.length <= 500,
  volume: (v) => typeof v === 'number' && v >= 0 && v <= 100,
  coo: bool,
  rustle: bool,
  ambience: bool,
  notifyLetter: bool,
  notifyBird: bool,
  notifyFriend: bool,
  channel: (v) => v === 'email' || v === 'browser',
  shareBird: bool,
  shareStats: bool,
}

const FIELDS = {
  name: (v: unknown) => str(v, 64, 'name'), // default name is the email local part (max 64)
  homeCity: (v: unknown): City => {
    if (!isObj(v)) return bad('invalid homeCity')
    return {
      name: str(v.name, 100, 'homeCity.name'),
      country: str(v.country, 100, 'homeCity.country'),
      cc: cc(v.cc, 'homeCity.cc'),
      lat: roundCoord(num(v.lat, -90, 90, 'homeCity.lat')),
      lng: roundCoord(num(v.lng, -180, 180, 'homeCity.lng')),
    }
  },
  bird: (v: unknown): Bird => {
    if (!isObj(v) || !(BIRD_IDS as readonly unknown[]).includes(v.species)) return bad('unknown bird species')
    return { species: v.species as string, name: str(v.name, 20, 'bird.name') }
  },
  settings: (v: unknown): Partial<Settings> => {
    if (!isObj(v)) return bad('invalid settings')
    for (const [k, val] of Object.entries(v)) if (!Object.hasOwn(SETTINGS, k) || !SETTINGS[k as keyof Settings](val)) bad(`invalid setting ${k}`)
    return v as Partial<Settings>
  },
}

/** Validates a (partial) Profile object; fields left out keep their stored value. */
export function parseProfileFields(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v)) {
    if (!Object.hasOwn(FIELDS, k)) bad(`unknown field ${k}`)
    out[k] = FIELDS[k as keyof typeof FIELDS](val)
  }
  return out
}

/**
 * Creates or updates the caller's profile with already-validated `fields`, allocating the invite code on first write.
 * Shared by PUT /me and POST /import. Returns the stored item (ALL_NEW). With `importedAt` the write is conditional on the
 * profile not being imported yet (ConditionalCheckFailed propagates).
 */
export async function saveProfile(sub: string, email: unknown, fields: Record<string, unknown>, importedAt?: number): Promise<Record<string, unknown>> {

  // Best-effort uniqueness: regenerate while another user already holds the code. Not atomic (GSIs cannot enforce
  // uniqueness), but 34^8 codes make a race negligible; POST /friends/request refuses an ambiguous code anyway.
  let code = newInviteCode()
  for (let i = 0; i < 5; i++) {
    const taken = await ddb.send(new QueryCommand({ TableName: tableName(), IndexName: 'GSI1', KeyConditionExpression: 'GSI1PK = :pk', ExpressionAttributeValues: { ':pk': codePk(code) }, Limit: 1 }))
    if (!taken?.Items?.length) break
    if (i === 4) return fail(503, 'could not allocate an invite code; retry')
    code = newInviteCode()
  }
  const names: Record<string, string> = {}
  const values: Record<string, unknown> = { ':code': code, ':gsi1pk': codePk(code), ':gsi1sk': userPk(sub) }
  // if_not_exists is an atomic conditional write: concurrent first PUTs agree on one code and later PUTs keep it.
  const sets = ['inviteCode = if_not_exists(inviteCode, :code)', 'GSI1PK = if_not_exists(GSI1PK, :gsi1pk)', 'GSI1SK = :gsi1sk']
  // the sign-in email, kept on the profile only for letter alerts (friend and letter rows copy whitelisted fields, never this)
  if (typeof email === 'string' && email.length <= 254) {
    values[':email'] = email
    sets.push('email = :email')
  }
  if (importedAt !== undefined) {
    values[':importedAt'] = importedAt
    sets.push('importedAt = :importedAt')
  }
  for (const [k, v] of Object.entries(fields)) {
    names[`#${k}`] = k
    values[`:${k}`] = v
    sets.push(`#${k} = :${k}`)
  }

  const res = await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: PROFILE_SK },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: importedAt === undefined ? undefined : 'attribute_not_exists(importedAt)',
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  )
  return res.Attributes ?? {}
}

export const handler = route(async (sub, event) =>
  json(200, profileOut(await saveProfile(sub, event.requestContext.authorizer.jwt.claims.email, parseProfileFields(parseBody(event.body))))),
)
