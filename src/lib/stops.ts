import { KM_PER_FOCUS_MINUTE } from './geo'

/** Route km of each future stop, one per focus slot from `fromKm`, ending at the destination. */
export function stopsAhead(routeKm: number, fromKm: number, slotMin: number): number[] {
  if (fromKm >= routeKm) return []
  const step = slotMin * KM_PER_FOCUS_MINUTE
  const stops: number[] = []
  if (step > 0) for (let km = fromKm + step; km < routeKm - 1; km += step) stops.push(km) // a stop within 1 km of the end merges into it
  return [...stops, routeKm]
}
