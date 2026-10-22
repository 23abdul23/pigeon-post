import { greatCircle, haversineKm, routeLengthKm, type Pt } from './geo'
import { landRoute } from './landRoute'
import { send } from './outbox'
import { getState, setState, type City, type Place, type Trip } from './store'

/** Route from home to dest as [lat, lng] points, following land where it can (see landRoute.ts). Short hops stay a straight line. */
export function planRoute(from: Pt, to: Pt): Pt[] {
  return haversineKm({ lat: from[0], lng: from[1] }, { lat: to[0], lng: to[1] }) < 300 ? greatCircle(from, to, 50) : landRoute(from, to)
}

export function createTrip(dest: Place, opts: { friendId?: string; letterIds?: string[] } = {}): Trip {
  const home = getState().homeCity
  if (!home) throw new Error('Home city is required before starting a trip')
  const route = planRoute([home.lat, home.lng], [dest.lat, dest.lng])
  const trip: Trip = {
    id: crypto.randomUUID(),
    dest,
    route,
    routeKm: Math.max(50, routeLengthKm(route)),
    progressKm: 0,
    status: 'OUTBOUND',
    legs: 0,
    friendId: opts.friendId,
    letterIds: opts.letterIds ?? [],
    origin: home, // the server snapshots the same home city, so every device plans this route from here
  }
  setState({ trip, landing: null })
  void send({ id: `trip:${trip.id}`, method: 'POST', path: '/trips', body: { id: trip.id, dest, routeKm: trip.routeKm, friendId: trip.friendId, letterIds: trip.letterIds }, touches: ['trip'] })
  return trip
}

/**
 * The server keeps no route: reuse ours when it is the same leg of the same trip, else plan it again from the trip's origin
 * (the current home for older trips without one), reversed when flying home.
 */
export function withRoute(t: Omit<Trip, 'route'>, home: City | null | undefined): Trip | null {
  const local = getState().trip
  if (local?.id === t.id && (local.status === 'RETURNING') === (t.status === 'RETURNING')) return { ...t, route: local.route }
  const from = t.origin ?? home
  if (!from) return null
  const route = planRoute([from.lat, from.lng], [t.dest.lat, t.dest.lng])
  return { ...t, route: t.status === 'RETURNING' ? route.reverse() : route }
}
