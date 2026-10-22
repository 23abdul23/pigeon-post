import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { handler as importer } from '../src/handlers/import'

process.env.TABLE_NAME = 'PigeonPostTest'
const ddb = mockClient(DynamoDBDocumentClient)

type Item = Record<string, any>
let table: Map<string, Item>
let failOnce: ((i: Item) => boolean) | undefined
const key = (k: { PK: string; SK: string }) => `${k.PK}|${k.SK}`

// A tiny in-memory table: conditional puts, SET updates (with if_not_exists), PK queries; the GSI1 collision query finds nothing.
beforeEach(() => {
  table = new Map()
  failOnce = undefined
  ddb.reset()
  ddb.on(GetCommand).callsFake((i) => ({ Item: table.get(key(i.Key)) }))
  ddb.on(PutCommand).callsFake((i) => {
    if (failOnce?.(i.Item)) {
      failOnce = undefined
      throw new Error('boom')
    }
    if (i.ConditionExpression && table.has(key(i.Item))) throw Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' })
    table.set(key(i.Item), { ...i.Item })
    return {}
  })
  ddb.on(UpdateCommand).callsFake((i) => {
    const cur = table.get(key(i.Key))
    if (i.ConditionExpression?.includes('attribute_not_exists(importedAt)') && cur?.importedAt) throw Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' })
    const item: Item = { ...i.Key, ...cur }
    for (const part of i.UpdateExpression.replace(/^SET /, '').split(/, (?![^(]*\))/)) {
      const [lhs, rhs] = part.split(' = ')
      const name = i.ExpressionAttributeNames?.[lhs] ?? lhs
      const m = rhs.match(/^if_not_exists\(\w+, (:\w+)\)$/)
      if (m) item[name] ??= i.ExpressionAttributeValues[m[1]]
      else item[name] = i.ExpressionAttributeValues[rhs]
    }
    table.set(key(i.Key), item)
    return { Attributes: item }
  })
  ddb.on(QueryCommand).callsFake((i) => {
    if (i.IndexName) return { Items: [] }
    const pk = i.ExpressionAttributeValues[':pk']
    const prefix = i.ExpressionAttributeValues[':sk']
    return { Items: [...table.values()].filter((x) => x.PK === pk && (!prefix || x.SK.startsWith(prefix))) }
  })
})

const ev = (body?: unknown, raw?: string) =>
  ({ body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), requestContext: { authorizer: { jwt: { claims: { sub: 'u1', email: 'a@b.c' }, scopes: [] } } } }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
const call = async (e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = (await importer(e)) as APIGatewayProxyStructuredResultV2
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }
}

const city = { name: 'Zagreb', country: 'Croatia', cc: 'HR', lat: 45.81, lng: 15.98 }
const dest = { id: 'p1', name: 'Split', country: 'Croatia', cc: 'HR', lat: 43.51, lng: 16.44 }
const story = (n: number, over = {}) => ({ id: `s${n}`, place: 'Split', country: 'Croatia', cc: 'HR', lens: 'Legend', text: 'text', birds: [], lat: 43.51, lng: 16.44, dateMs: 1000 + n, saved: false, km: 10, ...over })
const stamp = { cc: 'HR', country: 'Croatia', firstMs: 5, visits: 2 }
const session = (n: number) => ({ id: `x${n}`, tripId: 't1', startMs: 1, endMs: 2, km: 5, reason: 'completed' })
const trip = { id: 't1', dest, routeKm: 300, progressKm: 50, status: 'OUTBOUND', legs: 1, letterIds: [] }
const full = () => ({ profile: { name: 'Ana', homeCity: city, bird: { species: 'stork', name: 'Pip' }, settings: { volume: 10 } }, trip, stories: [story(1), story(2)], stamps: [stamp], sessions: [session(1)] })

describe('POST /import', () => {
  it('import_creates_profile_trip_stories_stamps', async () => {
    const r = await call(ev(full()))
    expect(r.status).toBe(200)
    expect(r.body.profile).toMatchObject({ name: 'Ana', homeCity: city, bird: { species: 'stork', name: 'Pip' } })
    expect(r.body.profile.inviteCode).toMatch(/^[A-Z2-9]{8}$/)
    expect(r.body.profile.importedAt).toBeUndefined()
    expect(r.body.profile.email).toBeUndefined()
    expect(r.body.trip).toMatchObject({ id: 't1', routeKm: 300, progressKm: 50, origin: city })
    expect(r.body.stories.map((s: Story) => s.id).sort()).toEqual(['s1', 's2'])
    expect(r.body.stamps).toEqual([stamp])
    expect(r.body.sessions).toHaveLength(1)
    expect(table.get('USER#u1|PROFILE')!.importedAt).toBeTypeOf('number')
  })

  it('import_rejects_when_already_imported_409', async () => {
    expect((await call(ev(full()))).status).toBe(200)
    const writes = ddb.commandCalls(PutCommand).length
    expect((await call(ev(full()))).status).toBe(409)
    expect(ddb.commandCalls(PutCommand)).toHaveLength(writes)
  })

  it('import_is_rerunnable_after_partial_failure', async () => {
    failOnce = (i) => i.SK === 'STORY#s2'
    await expect(call(ev(full()))).rejects.toThrow('boom')
    expect(table.has('USER#u1|PROFILE')).toBe(false) // GET /state keeps saying "no profile", so the client retries
    expect(table.has('USER#u1|STORY#s1') || table.has('USER#u1|STORY#s2')).toBe(true)
    table.set('USER#u1|STORY#s1', { ...table.get('USER#u1|STORY#s1'), text: 'server edit' }) // a copy already there is kept
    const r = await call(ev(full()))
    expect(r.status).toBe(200)
    expect(r.body.stories).toHaveLength(2)
    expect(r.body.stories.find((s: Story) => s.id === 's1').text).toBe('server edit')
    expect(table.get('USER#u1|PROFILE')!.importedAt).toBeTypeOf('number')
  })

  it('import_rounds_coordinates_and_rejects_bad_bird', async () => {
    const r = await call(ev({ ...full(), profile: { homeCity: { ...city, lat: 45.81444, lng: 15.97798 } }, stories: [story(1, { lat: 43.51234, lng: 16.4456 })], trip: { ...trip, dest: { ...dest, lat: 43.50999 } } }))
    expect(r.status).toBe(200)
    expect(r.body.profile.homeCity).toMatchObject({ lat: 45.81, lng: 15.98 })
    expect(r.body.stories[0]).toMatchObject({ lat: 43.51, lng: 16.45 })
    expect(r.body.trip.dest.lat).toBe(43.51)
    table.clear()
    ddb.resetHistory()
    expect((await call(ev({ ...full(), profile: { bird: { species: 'pigeon', name: 'Pip' } } }))).status).toBe(400)
    expect((await call(ev({ ...full(), profile: { settings: { isAdmin: true } } }))).status).toBe(400)
    expect((await call(ev({ ...full(), stamps: [{ ...stamp, cc: 'hrv' }] }))).status).toBe(400)
    expect((await call(ev({ ...full(), stories: [story(1, { id: 'a/b' })] }))).status).toBe(400)
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0) // validation happens before any write
    expect(table.size).toBe(0)
  })

  it('partial_import_failure_leaves_profile_null_so_the_client_retries', async () => {
    failOnce = (i) => i.SK === 'SESSION#x1'
    await expect(call(ev(full()))).rejects.toThrow('boom')
    expect(table.has('USER#u1|PROFILE')).toBe(false)
    const { handler: state } = await import('../src/handlers/state')
    const s = JSON.parse(((await state(ev())) as APIGatewayProxyStructuredResultV2).body!)
    expect(s.profile).toBeNull()
    expect((await call(ev(full()))).status).toBe(200)
    expect(table.get('USER#u1|PROFILE')!.importedAt).toBeTypeOf('number')
  })

  it('import_clamps_session_km_to_the_session_length', async () => {
    const long = { ...session(1), startMs: 0, endMs: 60_000, km: 5000 } // one minute: at most ~105 km
    const back = { ...session(2), startMs: 9, endMs: 3, km: 50 } // ends before it starts
    const r = await call(ev({ ...full(), sessions: [long, back] }))
    expect(r.status).toBe(200)
    const km = Object.fromEntries(r.body.sessions.map((x: { id: string; km: number }) => [x.id, x.km]))
    expect(km.x1).toBeCloseTo(105)
    expect(km.x2).toBe(0)
    table.clear()
    expect((await call(ev({ ...full(), stamps: [{ ...stamp, visits: 10001 }] }))).status).toBe(400)
  })

  it('import_caps_stories_at_200', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => story(i))
    expect((await call(ev({ ...full(), stories: many(201) }))).status).toBe(400)
    expect(table.size).toBe(0)
    const ok = await call(ev({ stories: many(200), stamps: [], sessions: [] }))
    expect(ok.status).toBe(200)
    expect(ok.body.stories).toHaveLength(200)
    expect((await call(ev(undefined, 'x'.repeat(256 * 1024 + 1)))).status).toBe(413)
  })

  it('import_does_not_overwrite_an_existing_server_trip', async () => {
    table.set('USER#u1|PROFILE', { PK: 'USER#u1', SK: 'PROFILE', inviteCode: 'ABCDEFGH', homeCity: { ...city, name: 'Server City' } })
    table.set('USER#u1|TRIP#srv', { PK: 'USER#u1', SK: 'TRIP#srv', id: 'srv', dest, origin: city, routeKm: 99, progressKm: 0, status: 'OUTBOUND', legs: 0, letterIds: [], createdMs: 1 })
    const r = await call(ev(full()))
    expect(r.status).toBe(200)
    expect(r.body.trip.id).toBe('srv')
    expect(table.has('USER#u1|TRIP#t1')).toBe(false)
    expect(r.body.profile.homeCity.name).toBe('Server City') // existing profile fields win too
    expect(r.body.profile.name).toBe('Ana') // missing ones are filled
  })
})

type Story = { id: string; text: string }
