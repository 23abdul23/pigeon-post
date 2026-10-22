import { greatCircle, haversineKm, routeLengthKm, type Pt } from './geo'
import { landRoute } from './landRoute'
import { getState, setState, type Place, type Trip } from './store'

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
  }
  setState({ trip, landing: null })
  return trip
}
