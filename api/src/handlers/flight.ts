import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import type { ActiveFlight } from '../../../src/lib/types'
import { FLIGHT_STALE_MS } from '../lib/constants'
import { ddb, flightOut, isConditionFail, tableName } from '../lib/db'
import { bad, fail, id, json, num, parseBody, route } from '../lib/http'
import { flightSk, tripSk, userPk } from '../lib/keys'

const MIN = 60000
const HOUR = 60 * MIN

/**
 * PUT /flight: starts, heartbeats or takes over the one flight in progress.
 * Same device and startMs: a heartbeat (only heartbeatMs and leftAtMs change). Another device's flight is replaced only when
 * stale or with `takeover: true`, otherwise 409 { flight }. Every write is conditional on the version read, so two devices
 * racing never both own it: the loser re-reads once and gets the right answer.
 */
const putFlight = route(async (sub, event) => {
  const b = parseBody(event.body)
  const now = Date.now()
  const tripId = id(b.tripId, 'tripId')
  const startMs = num(b.startMs, now - 24 * HOUR, now + 5 * MIN, 'startMs')
  const durationMin = Number.isInteger(b.durationMin) ? num(b.durationMin, 5, 120, 'durationMin') : bad('invalid durationMin')
  const deviceId = typeof b.deviceId === 'string' && /^[\w-]{8,64}$/.test(b.deviceId) ? b.deviceId : bad('invalid deviceId')
  const leftAtMs = b.leftAtMs === undefined ? undefined : num(b.leftAtMs, startMs, now + 5 * MIN, 'leftAtMs')

  const PK = userPk(sub)
  const TableName = tableName()
  const Key = { PK, SK: flightSk() }
  const get = async (SK: string) => (await ddb.send(new GetCommand({ TableName, Key: { PK, SK }, ConsistentRead: true }))).Item
  const trip = await get(tripSk(tripId)) // the caller's own partition, so someone else's trip is simply not there
  if (!trip || (trip.status !== 'OUTBOUND' && trip.status !== 'RETURNING')) return fail(404, 'no flying trip with that id')
  const baseKm = num(b.baseKm, 0, Number(trip.routeKm), 'baseKm')

  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await get(flightSk())
    try {
      if (cur?.deviceId === deviceId && cur.startMs === startMs) {
        const r = await ddb.send(
          new UpdateCommand({
            TableName,
            Key,
            UpdateExpression: leftAtMs === undefined ? 'SET heartbeatMs = :hb REMOVE leftAtMs' : 'SET heartbeatMs = :hb, leftAtMs = :left',
            ConditionExpression: 'deviceId = :d AND startMs = :s',
            ExpressionAttributeValues: { ':hb': now, ':d': deviceId, ':s': startMs, ...(leftAtMs === undefined ? {} : { ':left': leftAtMs }) },
            ReturnValues: 'ALL_NEW',
          }),
        )
        return json(200, flightOut(r.Attributes ?? {}))
      }
      if (cur && cur.deviceId !== deviceId && now - Number(cur.heartbeatMs) <= FLIGHT_STALE_MS && b.takeover !== true) return json(409, { flight: flightOut(cur) })
      const flight: ActiveFlight = { tripId, startMs, durationMin, baseKm, deviceId, leftAtMs, heartbeatMs: now }
      await ddb.send(
        new PutCommand({
          TableName,
          Item: { ...Key, ...flight, ttl: Math.floor(startMs / 1000) + durationMin * 60 + 24 * 3600 },
          ...(cur
            ? { ConditionExpression: 'deviceId = :d AND startMs = :s AND heartbeatMs = :hb', ExpressionAttributeValues: { ':d': cur.deviceId, ':s': cur.startMs, ':hb': cur.heartbeatMs } }
            : { ConditionExpression: 'attribute_not_exists(PK)' }),
        }),
      )
      return json(200, flight)
    } catch (e) {
      if (!isConditionFail(e)) throw e
    }
  }
  return fail(503, 'flight is busy; retry')
})

/** DELETE /flight: abandon without landing; idempotent. */
const deleteFlight = route(async (sub) => {
  await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: flightSk() } }))
  return { statusCode: 204 }
})

const ROUTES: Record<string, typeof putFlight> = { 'PUT /flight': putFlight, 'DELETE /flight': deleteFlight }
export const handler = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => (ROUTES[event.routeKey] ?? (async () => json(404, { error: 'not found' })))(event)
