export const KM_PER_FOCUS_MINUTE = 100
/** A flight with no heartbeat for this long may be taken over by another device (server copy: api/src/lib/constants.ts). */
export const FLIGHT_STALE_MS = 90000

export type LatLng = { lat: number; lng: number }
export type Pt = [lat: number, lng: number]

const R = 6371

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function flagEmoji(cc: string): string {
  return cc
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
}

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null

export function countryName(cc: string): string {
  try {
    return regionNames?.of(cc.toUpperCase()) ?? cc
  } catch {
    return cc
  }
}

export const fmtKm = (km: number) => `${Math.round(km).toLocaleString('en-US')} km`

/** A longitude in [-180, 180): routes carry unwrapped longitudes (past ±180) so a line never jumps across the map. */
export const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180

const ptKm = (a: Pt, b: Pt) => haversineKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] })

/** Initial compass bearing in degrees (0 = north) from a to b. */
export function bearing(a: Pt, b: Pt): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]))
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]))
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** Signed shortest turn in degrees from one compass bearing to another, in (-180, 180]; positive = clockwise. */
export const shortestAngleDelta = (from: number, to: number) => {
  const d = ((((to - from) % 360) + 360) % 360)
  return d > 180 ? d - 360 : d
}

/** Move a bearing toward the target by at most ratePerSec * dtSec degrees, the short way round; result in [0, 360). */
export function easeBearing(current: number, target: number, dtSec: number, ratePerSec: number): number {
  const d = shortestAngleDelta(current, target)
  const step = Math.min(Math.abs(d), ratePerSec * dtSec)
  return (((current + Math.sign(d) * step) % 360) + 360) % 360
}

/** Points along the great circle from a to b, about one every stepKm. */
export function greatCircle(a: Pt, b: Pt, stepKm = 50): Pt[] {
  const d = ptKm(a, b) / R
  const n = Math.max(2, Math.ceil(ptKm(a, b) / stepKm))
  if (d === 0) return [a, b]
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const f = i / n
    const A = Math.sin((1 - f) * d) / Math.sin(d)
    const B = Math.sin(f * d) / Math.sin(d)
    const x = A * Math.cos(rad(a[0])) * Math.cos(rad(a[1])) + B * Math.cos(rad(b[0])) * Math.cos(rad(b[1]))
    const y = A * Math.cos(rad(a[0])) * Math.sin(rad(a[1])) + B * Math.cos(rad(b[0])) * Math.sin(rad(b[1]))
    const z = A * Math.sin(rad(a[0])) + B * Math.sin(rad(b[0]))
    const last = out.length ? out[out.length - 1][1] : a[1]
    const lng = Math.hypot(x, y) < 1e-12 ? last : deg(Math.atan2(y, x)) // at a pole every longitude is the same point
    // unwrapped like landRoute's, so a hop over the antimeridian draws as one short line, not a world-wide jump
    out.push([deg(Math.atan2(z, Math.hypot(x, y))), lng + 360 * Math.round((last - lng) / 360)])
  }
  return out
}

export function routeLengthKm(route: Pt[]): number {
  let km = 0
  for (let i = 1; i < route.length; i++) km += ptKm(route[i - 1], route[i])
  return km
}

/** Point and heading after travelling km along the route; clamps to both ends. */
export function pointAtKm(route: Pt[], km: number): { pt: Pt; bearing: number; index: number } {
  if (route.length < 2) return { pt: route[0] ?? [0, 0], bearing: 0, index: 0 }
  let left = Math.max(0, km)
  for (let i = 1; i < route.length; i++) {
    const seg = ptKm(route[i - 1], route[i])
    if (left <= seg || i === route.length - 1) {
      const f = seg === 0 ? 0 : Math.min(1, left / seg)
      const a = route[i - 1]
      const b = route[i]
      return { pt: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], bearing: bearing(a, b), index: i }
    }
    left -= seg
  }
  return { pt: route[route.length - 1], bearing: 0, index: route.length - 1 }
}
