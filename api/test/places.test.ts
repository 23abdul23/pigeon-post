import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mockClient } from 'aws-sdk-client-mock'
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { handler } from '../src/handlers/places'
import { photonKind } from '../src/lib/geocoders'

process.env.TABLE_NAME = 'PigeonPostTest'
process.env.PHOTON_BASE_URL = 'https://photon.test'
process.env.OPEN_METEO_GEOCODING_URL = 'https://om.test'
process.env.GEOCODER_CONTACT = 'ops@example.test'
const ddb = mockClient(DynamoDBDocumentClient)

// Real responses recorded once from photon.komoot.io and geocoding-api.open-meteo.com (2026-10-23), extent/extra and ids trimmed.
const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
const PHOTON_SEARCH = fx('photon-search')
const PHOTON_ANY = fx('photon-search-any')
const PHOTON_REVERSE = fx('photon-reverse')
const PHOTON_OCEAN = fx('photon-reverse-ocean')
const OM_SEARCH = fx('open-meteo-search')

type Reply = unknown | ((url: URL) => unknown)
let photon: Reply
let openMeteo: Reply
const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
  const url = new URL(String(input))
  const r = url.host === 'photon.test' ? photon : openMeteo
  const v = typeof r === 'function' ? r(url) : r
  if (v instanceof Error) throw v
  if (v instanceof Response) return v
  return new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } })
})
const urls = () => fetchMock.mock.calls.map((c) => new URL(String(c[0])))

const ev = (path: 'search' | 'reverse', qs: Record<string, string>) =>
  ({
    routeKey: `GET /places/${path}`,
    queryStringParameters: qs,
    headers: { authorization: 'Bearer secret-jwt', cookie: 'session=abc', 'x-forwarded-for': '203.0.113.9' },
    requestContext: {
      http: { sourceIp: '203.0.113.9' },
      authorizer: { jwt: { claims: { sub: 'u1', email: 'me@example.com' }, scopes: [] } },
    },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
const call = async (path: 'search' | 'reverse', qs: Record<string, string>) => {
  const r = (await handler(ev(path, qs))) as APIGatewayProxyStructuredResultV2
  return { status: r.statusCode, body: JSON.parse(r.body!) }
}
const search = (qs: Record<string, string>) => call('search', qs)
const cancelled = (globalFail: boolean, userFail: boolean) =>
  new TransactionCanceledException({
    message: 'cancelled',
    $metadata: {},
    CancellationReasons: [{ Code: globalFail ? 'ConditionalCheckFailed' : 'None' }, { Code: userFail ? 'ConditionalCheckFailed' : 'None' }],
  })

beforeEach(() => {
  ddb.reset()
  ddb.on(GetCommand).resolves({})
  ddb.on(PutCommand).resolves({})
  ddb.on(TransactWriteCommand).resolves({})
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  photon = PHOTON_SEARCH
  openMeteo = OM_SEARCH
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('places search', () => {
  it('search_returns_at_most_8_places_with_cc', async () => {
    const many = { ...PHOTON_SEARCH, features: [...PHOTON_SEARCH.features, ...PHOTON_SEARCH.features.map((f: { properties: object }, i: number) => ({ ...f, properties: { ...f.properties, name: `Berlin ${i}` } }))] }
    photon = many
    const r = await search({ q: 'berlin' })
    expect(r.status).toBe(200)
    expect(r.body.source).toBe('photon')
    expect(r.body.places).toHaveLength(8)
    for (const p of r.body.places) expect(p.cc).toMatch(/^[A-Z]{2}$/)
    expect(r.body.places[0]).toEqual({ id: 'photon:R62422', name: 'Berlin', country: 'Germany', cc: 'DE', lat: 52.52, lng: 13.4, kind: 'locality' })
    expect(r.body.places[1]).toMatchObject({ id: 'photon:R170184', region: 'New Hampshire', cc: 'US', lat: 44.47, lng: -71.18 })
  })

  it('search_drops_results_without_country_code', async () => {
    const f = PHOTON_SEARCH.features
    photon = { ...PHOTON_SEARCH, features: [{ ...f[0], properties: { ...f[0].properties, countrycode: undefined } }, { ...f[1], properties: { ...f[1].properties, countrycode: 'USA' } }, f[2]] }
    const r = await search({ q: 'berlin' })
    expect(r.body.places.map((p: { id: string }) => p.id)).toEqual(['photon:R126290'])
  })

  it('search_city_kind_requests_city_and_locality_layers_and_drops_streets', async () => {
    const street = { type: 'Feature', properties: { osm_type: 'W', osm_id: 1, osm_key: 'highway', osm_value: 'residential', type: 'street', name: 'Berliner Straße', city: 'Potsdam', country: 'Germany', countrycode: 'DE' }, geometry: { type: 'Point', coordinates: [13.06, 52.4] } }
    photon = { ...PHOTON_SEARCH, features: [street, ...PHOTON_SEARCH.features.slice(0, 2), PHOTON_ANY.features[1]] }
    const r = await search({ q: 'berlin', kind: 'city' })
    expect(urls()[0].searchParams.getAll('layer')).toEqual(['city', 'locality'])
    expect(r.body.places.map((p: { id: string }) => p.id)).toEqual(['photon:R62422', 'photon:R170184']) // street and the peak (poi) dropped
    expect(r.body.places.every((p: { kind: string }) => p.kind === 'locality')).toBe(true)
  })

  it('search_any_kind_keeps_landmarks_and_regions', async () => {
    const region = { type: 'Feature', properties: { osm_type: 'R', osm_id: 8649, osm_key: 'boundary', osm_value: 'administrative', type: 'state', name: 'Île-de-France', country: 'France', countrycode: 'FR' }, geometry: { type: 'Point', coordinates: [2.5, 48.7] } }
    const address = { type: 'Feature', properties: { osm_type: 'N', osm_id: 2, osm_key: 'place', osm_value: 'house', type: 'house', housenumber: '21', street: 'Rue X', name: 'Rue X 21', country: 'France', countrycode: 'FR' }, geometry: { type: 'Point', coordinates: [2.3, 48.8] } }
    photon = { ...PHOTON_ANY, features: [...PHOTON_ANY.features.slice(0, 2), region, address] }
    const r = await search({ q: 'eiffel tower', kind: 'any' })
    expect(urls()[0].searchParams.getAll('layer')).toEqual([])
    expect(r.body.places.map((p: { id: string; kind: string }) => [p.id, p.kind])).toEqual([
      ['photon:W5013364', 'poi'], // the real Eiffel Tower: Photon types it "house" (it has a housenumber) but it is a named man_made feature
      ['photon:N2689315641', 'poi'],
      ['photon:R8649', 'region'],
    ])
    expect(r.body.places[0]).toMatchObject({ name: 'Eiffel Tower', region: 'Île-de-France', cc: 'FR', lat: 48.86, lng: 2.29 })
  })

  it('photon_osm_values_map_to_place_kinds', () => {
    for (const v of ['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'locality']) expect(photonKind('place', v)).toBe('locality')
    for (const v of ['state', 'county', 'country', 'region', 'province', 'district']) expect(photonKind('place', v)).toBe('region')
    expect(photonKind('boundary', 'administrative')).toBe('region')
    expect(photonKind('man_made', 'tower')).toBe('poi')
    expect(photonKind('natural', 'peak')).toBe('poi')
    expect(photonKind(undefined, undefined)).toBe('poi')
  })

  it('search_cache_hit_skips_upstreams_and_does_not_count', async () => {
    const cached = [{ id: 'photon:R62422', name: 'Berlin', country: 'Germany', cc: 'DE', lat: 52.52, lng: 13.4, kind: 'locality' }]
    const store = new Map<string, Record<string, unknown>>()
    ddb.on(GetCommand).callsFake((i) => ({ Item: store.get(i.Key.PK) }))
    ddb.on(PutCommand).callsFake((i) => void store.set(i.Item.PK, i.Item))
    await search({ q: 'Zürich' })
    const put = ddb.commandCall(0, PutCommand).args[0].input.Item!
    expect(put.PK).toMatch(/^GEO#[0-9a-f]{24}$/)
    expect(put).toMatchObject({ SK: 'SEARCH', source: 'photon' })
    expect(put.ttl).toBeGreaterThan(Date.now() / 1000 + 29 * 86400)
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(1)
    // Same key after case, diacritics and whitespace normalisation.
    store.set(put.PK as string, { ...put, places: cached })
    fetchMock.mockClear()
    const r = await search({ q: '  zurich ' })
    expect(r).toEqual({ status: 200, body: { places: cached, source: 'cache' } })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(1)
    // A cache write failure never fails the request.
    ddb.on(PutCommand).rejects(new Error('boom'))
    expect((await search({ q: 'paris' })).status).toBe(200)
  })

  it('search_falls_back_to_open_meteo_when_photon_times_out_or_returns_429', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    for (const bad of [Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), new Response('slow down', { status: 429 })]) {
      photon = bad
      fetchMock.mockClear()
      const r = await search({ q: 'berlin' })
      expect(r.status).toBe(200)
      expect(r.body.source).toBe('open-meteo')
      expect(r.body.places[0]).toEqual({ id: 'om:2950159', name: 'Berlin', region: 'State of Berlin', country: 'Germany', cc: 'DE', lat: 52.52, lng: 13.41, kind: 'locality' })
      expect(r.body.places.length).toBeLessThanOrEqual(8)
      const om = urls()[1]
      expect(om.pathname).toBe('/v1/search')
      expect(om.searchParams.get('name')).toBe('berlin')
    }
    expect(timeout).toHaveBeenCalledWith(2500)
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(2) // counted once per search, not per upstream
  })

  it('search_is_503_when_both_upstreams_fail', async () => {
    photon = new Response('down', { status: 502 })
    openMeteo = new TypeError('fetch failed')
    const r = await search({ q: 'berlin' })
    expect(r).toEqual({ status: 503, body: { error: 'places unavailable' } })
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0)
    // An empty Photon result is an answer, not a failure.
    photon = { type: 'FeatureCollection', features: [] }
    fetchMock.mockClear()
    expect((await search({ q: 'qqqzzz' })).body).toEqual({ places: [], source: 'photon' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('search_over_200_uncached_per_user_is_429', async () => {
    ddb.on(TransactWriteCommand).rejects(cancelled(false, true))
    const r = await search({ q: 'berlin' })
    expect(r.status).toBe(429)
    expect(fetchMock).not.toHaveBeenCalled()
    const items = ddb.commandCall(0, TransactWriteCommand).args[0].input.TransactItems!
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    expect(items[1].Update).toMatchObject({ Key: { PK: 'USER#u1', SK: `GEOUSE#${day}` }, ExpressionAttributeValues: { ':cap': 200 } })
  })

  it('search_over_8000_global_budget_is_503_without_calling_upstream', async () => {
    ddb.on(TransactWriteCommand).rejects(cancelled(true, true))
    const r = await search({ q: 'berlin' })
    expect(r.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
    const items = ddb.commandCall(0, TransactWriteCommand).args[0].input.TransactItems!
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    expect(items[0].Update).toMatchObject({ Key: { PK: 'GEO#GLOBAL', SK: `USE#${day}` }, ExpressionAttributeValues: { ':cap': 8000 } })
  })

  it('search_rejects_query_shorter_than_2_or_longer_than_80', async () => {
    for (const qs of <Record<string, string>[]>[{ q: 'a' }, { q: '   b  ' }, { q: 'x'.repeat(81) }, {}, { q: 'berlin', kind: 'street' }, { q: 'berlin', lat: '52.5' }, { q: 'berlin', lat: '91', lng: '0' }, { q: 'berlin', lat: 'abc', lng: '0' }]) {
      expect((await search(qs)).status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await search({ q: 'ab' })).status).toBe(200)
    expect((await search({ q: 'x'.repeat(80) })).status).toBe(200)
  })

  it('search_sends_bias_as_lat_and_lon_params', async () => {
    await search({ q: 'springfield', lat: '39.78167', lng: '-89.65012' })
    const u = urls()[0]
    expect(u.searchParams.get('lat')).toBe('39.78')
    expect(u.searchParams.get('lon')).toBe('-89.65')
    const key1 = ddb.commandCall(0, GetCommand).args[0].input.Key!.PK
    await search({ q: 'springfield', lat: '39.9', lng: '-90.3' }) // same whole-degree cell
    await search({ q: 'springfield' })
    expect(ddb.commandCall(1, GetCommand).args[0].input.Key!.PK).toBe(key1)
    expect(ddb.commandCall(2, GetCommand).args[0].input.Key!.PK).not.toBe(key1)
    expect(urls()[2].searchParams.has('lat')).toBe(false)
  })

  it('upstream_requests_carry_a_user_agent_and_no_user_identity', async () => {
    photon = new Response('', { status: 500 })
    await search({ q: 'berlin' })
    await call('reverse', { lat: '52.5', lng: '13.4' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [input, init] of fetchMock.mock.calls) {
      const h = new Headers(init?.headers)
      expect(h.get('user-agent')).toBe('PigeonPost/1.0 (ops@example.test)')
      expect([...h.keys()].sort()).toEqual(['accept', 'user-agent'])
      expect(init?.credentials ?? 'omit').toBe('omit')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      const s = String(input)
      for (const leak of ['u1', 'me@example.com', '203.0.113.9', 'secret-jwt', 'session']) expect(s).not.toContain(leak)
    }
  })
})

describe('places reverse', () => {
  it('reverse_rounds_input_before_calling_and_before_caching', async () => {
    photon = PHOTON_REVERSE
    const r = await call('reverse', { lat: '52.50431', lng: '13.39587' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ place: { id: 'photon:N2469854836', name: 'Berlin', country: 'Germany', cc: 'DE', lat: 52.5, lng: 13.4, kind: 'locality' }, source: 'photon' })
    const u = urls()[0]
    expect(u.pathname).toBe('/reverse')
    expect(u.searchParams.get('lat')).toBe('52.5')
    expect(u.searchParams.get('lon')).toBe('13.4')
    const key = ddb.commandCall(0, GetCommand).args[0].input.Key!
    expect(key.SK).toBe('REVERSE')
    expect(ddb.commandCall(0, PutCommand).args[0].input.Item!.PK).toBe(key.PK)
    await call('reverse', { lat: '52.499', lng: '13.401' }) // rounds to the same 2-decimal cell
    expect(ddb.commandCall(1, GetCommand).args[0].input.Key!.PK).toBe(key.PK)
    for (const qs of [{ lat: '91', lng: '0' }, { lat: '0', lng: '-180.5' }, { lat: '', lng: '0' }, { lat: '1e1', lng: '0' }]) {
      expect((await call('reverse', qs)).status).toBe(400)
    }
  })

  it('reverse_in_open_ocean_returns_null_place', async () => {
    photon = PHOTON_OCEAN
    const r = await call('reverse', { lat: '30', lng: '-30' })
    expect(r).toEqual({ status: 200, body: { place: null, source: 'photon' } })
    expect(ddb.commandCall(0, PutCommand).args[0].input.Item).toMatchObject({ SK: 'REVERSE', place: null })
    ddb.on(GetCommand).resolves({ Item: { place: null } })
    fetchMock.mockClear()
    expect((await call('reverse', { lat: '30', lng: '-30' })).body).toEqual({ place: null, source: 'cache' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
