import { randomInt } from 'node:crypto'
import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Bird, City, ServerProfile, Settings } from '../../../src/lib/types'
import { BIRD_IDS, roundCoord } from '../lib/constants'
import { clean, ddb, tableName } from '../lib/db'
import { bad, cc, isObj, json, num, parseBody, route, str } from '../lib/http'
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

/** Validates a (partial) Profile body; fields left out keep their stored value. */
function parse(body: string | undefined): Record<string, unknown> {
  const v = parseBody(body)
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v)) {
    if (!Object.hasOwn(FIELDS, k)) bad(`unknown field ${k}`)
    out[k] = FIELDS[k as keyof typeof FIELDS](val)
  }
  return out
}

export const handler = route(async (sub, event) => {
  const fields = parse(event.body)

  const code = newInviteCode()
  const names: Record<string, string> = {}
  const values: Record<string, unknown> = { ':code': code, ':gsi1pk': codePk(code), ':gsi1sk': userPk(sub) }
  // if_not_exists is an atomic conditional write: concurrent first PUTs agree on one code and later PUTs keep it.
  const sets = ['inviteCode = if_not_exists(inviteCode, :code)', 'GSI1PK = if_not_exists(GSI1PK, :gsi1pk)', 'GSI1SK = :gsi1sk']
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
      ExpressionAttributeNames: sets.length > 3 ? names : undefined,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  )
  return json(200, clean<ServerProfile>(res.Attributes ?? {}))
})
