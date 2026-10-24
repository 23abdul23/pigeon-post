import { isLand } from './landRoute'

type Row = [name: string, cc: string, lat: number, lng: number, pop: number]
const MAX_KM = 600
const CELL = 5
const key = (r: number, c: number) => `${r},${((c % 72) + 72) % 72}`
const cellOf = (lat: number, lng: number): [number, number] => [Math.floor((lat + 90) / CELL), Math.floor((lng + 180) / CELL)]

/**
 * Country at a point from bundled data only: nearest bundled city within 600 km, null over water (landmask).
 * Nearest-city is an approximation near borders.
 */
export async function loadCountryAt(): Promise<(lat: number, lng: number) => string | null> {
  const rows = (await import('../data/cities.json')).default as Row[]
  const grid = new Map<string, Row[]>()
  for (const r of rows) {
    const [a, b] = cellOf(r[2], r[3])
    const k = key(a, b)
    const cell = grid.get(k)
    if (cell) cell.push(r)
    else grid.set(k, [r])
  }
  return (lat, lng) => {
    if (!isLand(lat, lng)) return null
    const [r0, c0] = cellOf(lat, lng)
    const kx = Math.cos((lat * Math.PI) / 180)
    // widen ring by ring; one extra ring after the first hit since a nearer city may sit in an adjacent cell
    let best: Row | null = null
    let bestD = Infinity
    for (let ring = 1, found = -1; ring <= 18 && (found < 0 || ring <= found + 1); ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring && ring > 1) continue
          for (const r of grid.get(key(r0 + dr, c0 + dc)) ?? []) {
            const dLng = (((r[3] - lng + 540) % 360) - 180) * kx
            const d = (r[2] - lat) ** 2 + dLng ** 2
            if (d < bestD) {
              bestD = d
              best = r
              if (found < 0) found = ring
            }
          }
        }
      }
    }
    return best && Math.sqrt(bestD) * 111 <= MAX_KM ? best[1] : null
  }
}
