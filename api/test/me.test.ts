import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { BIRD_IDS, KM_PER_FOCUS_MINUTE, roundCoord } from '../src/lib/constants'
import { handler as me } from '../src/handlers/me'
import { handler as state } from '../src/handlers/state'

process.env.TABLE_NAME = 'PigeonPostTest'
const ddb = mockClient(DynamoDBDocumentClient)

const ev = (body?: unknown) =>
  ({
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub: 'u1' }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer

const call = async (h: typeof me, e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = (await h(e)) as APIGatewayProxyStructuredResultV2
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }
}

const city = { name: 'Zagreb', country: 'Croatia', cc: 'HR', lat: 45.81444, lng: 15.97798 }
const updates = () => ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input)

beforeEach(() => {
  ddb.reset()
  // what ReturnValues ALL_NEW gives for a fresh item
  ddb.on(UpdateCommand).callsFake((input) => {
    const v = input.ExpressionAttributeValues
    const fields = Object.values<string>(input.ExpressionAttributeNames ?? {}).map((k) => [k, v[`:${k}`]])
    return { Attributes: { PK: 'USER#u1', SK: 'PROFILE', GSI1PK: v[':gsi1pk'], GSI1SK: v[':gsi1sk'], inviteCode: v[':code'], ...Object.fromEntries(fields) } }
  })
})

describe('constants', () => {
  it('roundCoord_keeps_two_decimals', () => {
    expect(roundCoord(17.3851)).toBe(17.39)
    expect(roundCoord(-0.1234)).toBe(-0.12)
  })
  it('km_constant_matches_client', () => {
    const src = readFileSync(new URL('../../src/lib/geo.ts', import.meta.url), 'utf8')
    expect(Number(src.match(/KM_PER_FOCUS_MINUTE\s*=\s*(\d+)/)![1])).toBe(KM_PER_FOCUS_MINUTE)
  })
  it('bird_ids_match_client_list', () => {
    const src = readFileSync(new URL('../../src/lib/birds.ts', import.meta.url), 'utf8')
    const body = src.slice(src.indexOf('export const BIRDS'))
    const ids = [...body.matchAll(/\{ id: '([a-z]+)'/g)].map((m) => m[1])
    expect(ids).toEqual([...BIRD_IDS])
  })
})

describe('PUT /me', () => {
  it('put_me_rounds_home_city_coordinates', async () => {
    const r = await call(me, ev({ name: 'Ana', homeCity: city }))
    expect(r.status).toBe(200)
    const vals = updates()[0].ExpressionAttributeValues!
    expect(vals[':homeCity']).toEqual({ name: 'Zagreb', country: 'Croatia', cc: 'HR', lat: 45.81, lng: 15.98 })
    expect(JSON.stringify(updates()[0])).not.toContain('45.81444')
  })

  it('put_me_rejects_unknown_bird_species', async () => {
    const r = await call(me, ev({ bird: { species: 'pigeon', name: 'Pip' } }))
    expect(r.status).toBe(400)
    expect(updates()).toHaveLength(0)
    expect((await call(me, ev({ bird: { species: 'stork', name: 'Pip' } }))).status).toBe(200)
  })

  it('put_me_rejects_unknown_settings_keys', async () => {
    expect((await call(me, ev({ settings: { volume: 40, isAdmin: true } }))).status).toBe(400)
    expect((await call(me, ev({ settings: { volume: 'loud' } }))).status).toBe(400)
    expect((await call(me, ev({ settings: { channel: 'sms' } }))).status).toBe(400)
    expect(updates()).toHaveLength(0)
    expect((await call(me, ev({ settings: { volume: 40, channel: 'browser' } }))).status).toBe(200)
  })

  it('put_me_regenerates_an_invite_code_that_is_taken_and_503s_if_it_keeps_colliding', async () => {
    ddb.on(QueryCommand).resolvesOnce({ Items: [{ GSI1PK: 'x' }] }).resolves({ Items: [] })
    await call(me, ev({ name: 'Ana' }))
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(2) // first code taken, second free
    const [first, second] = ddb.commandCalls(QueryCommand).map((c) => c.args[0].input.ExpressionAttributeValues![':pk'])
    expect(second).not.toBe(first)
    expect(updates()[0].ExpressionAttributeValues![':gsi1pk']).toBe(second)

    ddb.reset()
    ddb.on(QueryCommand).resolves({ Items: [{ GSI1PK: 'x' }] })
    expect((await call(me, ev({ name: 'Ana' }))).status).toBe(503)
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0)
  })

  it('put_me_creates_invite_code_once_and_keeps_it', async () => {
    const first = await call(me, ev({ name: 'Ana' }))
    const u = updates()[0]
    const code = u.ExpressionAttributeValues![':code']
    expect(code).toMatch(/^[A-Z2-9]{8}$/)
    expect(first.body.inviteCode).toBe(code)
    // atomic: only set when absent, so a second or concurrent PUT keeps the stored code
    expect(u.UpdateExpression).toContain('inviteCode = if_not_exists(inviteCode, :code)')
    expect(u.UpdateExpression).toContain('GSI1PK = if_not_exists(GSI1PK, :gsi1pk)')
    expect(u.ExpressionAttributeValues![':gsi1pk']).toBe(`CODE#${code}`)

    ddb.on(UpdateCommand).resolves({ Attributes: { PK: 'USER#u1', SK: 'PROFILE', name: 'Ana', inviteCode: 'KEEPME22', GSI1PK: 'CODE#KEEPME22' } })
    const second = await call(me, ev({ name: 'Ana' }))
    expect(second.body).toEqual({ name: 'Ana', inviteCode: 'KEEPME22' })
  })

  it('put_me_keeps_the_sign_in_email_for_letter_alerts', async () => {
    const e = ev({ settings: { notifyLetter: true } })
    e.requestContext.authorizer.jwt.claims.email = 'ana@example.com'
    expect((await call(me, e)).status).toBe(200)
    expect(updates()[0].UpdateExpression).toContain('email = :email')
    expect(updates()[0].ExpressionAttributeValues![':email']).toBe('ana@example.com')
    await call(me, ev({}))
    expect(updates()[1].UpdateExpression).not.toContain('email') // no claim, nothing written
    expect(updates()[1].ExpressionAttributeNames).toBeUndefined()
  })

  it('put_me_rejects_bad_json_and_unknown_fields', async () => {
    expect((await call(me, { ...ev(), body: '{nope' } as APIGatewayProxyEventV2WithJWTAuthorizer)).status).toBe(400)
    expect((await call(me, ev({ inviteCode: 'AAAAAAAA' }))).status).toBe(400)
    expect((await call(me, ev({ homeCity: { ...city, lat: 123 } }))).status).toBe(400)
  })

  it('put_me_accepts_region_and_place_id_and_bounds_their_length', async () => {
    const r = await call(me, ev({ homeCity: { ...city, region: 'City of Zagreb', placeId: 'photon:R1234' } }))
    expect(r.status).toBe(200)
    expect(updates()[0].ExpressionAttributeValues![':homeCity']).toEqual({ name: 'Zagreb', region: 'City of Zagreb', country: 'Croatia', cc: 'HR', lat: 45.81, lng: 15.98, placeId: 'photon:R1234' })
    // bundled ids carry spaces and non-ASCII names
    expect((await call(me, ev({ homeCity: { ...city, placeId: 'CI-Abidjan Plateau-5.32' } }))).status).toBe(200)
    // old cities without them stay valid and gain no keys
    ddb.resetHistory()
    expect((await call(me, ev({ homeCity: city }))).status).toBe(200)
    expect(Object.keys(updates()[0].ExpressionAttributeValues![':homeCity']).sort()).toEqual(['cc', 'country', 'lat', 'lng', 'name'])
    // lengths count code points, as the places route trims them: 120 astral characters is a legal name and region
    const astral = '\u{1D4B3}'.repeat(120)
    expect((await call(me, ev({ homeCity: { ...city, name: astral, region: astral } }))).status).toBe(200)
    for (const bad of [{ region: 'x'.repeat(121) }, { placeId: 'x'.repeat(81) }, { placeId: 'a\u0007b' }, { region: 7 }, { placeId: '' }])
      expect((await call(me, ev({ homeCity: { ...city, ...bad } }))).status).toBe(400)
  })
})

describe('GET /state', () => {
  it('get_state_for_new_user_has_null_profile', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] })
    const r = await call(state, ev())
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ profile: null, trip: null, stories: [], letters: [], friends: [], stamps: [], sessions: [], flight: null, serverTime: expect.any(Number) })
    expect(ddb.commandCalls(QueryCommand)[0].args[0].input.ExpressionAttributeValues).toEqual({ ':pk': 'USER#u1' })
  })

  it('get_state_returns_profile_without_keys', async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ PK: 'USER#u1', SK: 'PROFILE', GSI1PK: 'CODE#X', GSI1SK: 'USER#u1', name: 'Ana', inviteCode: 'X' }] })
    expect((await call(state, ev())).body.profile).toEqual({ name: 'Ana', inviteCode: 'X' })
  })

  it('profile_responses_never_include_the_stored_email', async () => {
    // stored for letter alerts, never sent back: not by GET /state, not by PUT /me
    ddb.on(QueryCommand).resolves({ Items: [{ PK: 'USER#u1', SK: 'PROFILE', name: 'Ana', inviteCode: 'X', email: 'ana@example.com' }] })
    const st = await call(state, ev())
    expect(st.body.profile).toEqual({ name: 'Ana', inviteCode: 'X' })
    ddb.on(QueryCommand).resolves({ Items: [] })
    ddb.on(UpdateCommand).resolves({ Attributes: { PK: 'USER#u1', SK: 'PROFILE', name: 'Ana', inviteCode: 'X', email: 'ana@example.com' } })
    const e = ev({ name: 'Ana' })
    e.requestContext.authorizer.jwt.claims.email = 'ana@example.com'
    const put = await call(me, e)
    expect(put.body).toEqual({ name: 'Ana', inviteCode: 'X' })
    expect(updates().at(-1)!.ExpressionAttributeValues![':email']).toBe('ana@example.com') // still stored
  })

  it('get_state_returns_latest_trip_and_trip_data', async () => {
    const pk = { PK: 'USER#u1' }
    const trip = (id: string, createdMs: number) => ({ ...pk, SK: `TRIP#${id}`, id, routeKm: 100, progressKm: 0, status: 'DONE', legs: 1, letterIds: [], createdMs })
    ddb.on(QueryCommand).resolves({
      Items: [
        trip('old', 1),
        trip('new', 2),
        { ...pk, SK: 'SESSION#s1', id: 's1', tripId: 'new', startMs: 1, endMs: 2, km: 5, reason: 'left', result: { big: true } },
        { ...pk, SK: 'SESSION#s2', id: 's2', tripId: 'new', startMs: 3, endMs: 4, km: 5, reason: 'completed', result: {} },
        { ...pk, SK: 'STAMP#HR', cc: 'HR', country: 'Croatia', firstMs: 1, visits: 2 },
        { ...pk, SK: 'STORY#a', id: 'a', dateMs: 1 },
        { ...pk, SK: 'STORY#b', id: 'b', dateMs: 2 },
      ],
    })
    const b = (await call(state, ev())).body
    expect(b.trip).toEqual({ id: 'new', routeKm: 100, progressKm: 0, status: 'DONE', legs: 1, letterIds: [] })
    expect(b.sessions.map((s: { id: string }) => s.id)).toEqual(['s2', 's1']) // newest first, like the client
    expect(b.sessions[1]).toEqual({ id: 's1', tripId: 'new', startMs: 1, endMs: 2, km: 5, reason: 'left' })
    expect(b.stamps).toEqual([{ cc: 'HR', country: 'Croatia', firstMs: 1, visits: 2 }])
    expect(b.stories.map((s: { id: string }) => s.id)).toEqual(['b', 'a'])
  })
})
