import mask from '../data/landmask.json'
import { haversineKm, type Pt } from './geo'

/**
 * Land-preferring route on a 1 degree grid (Natural Earth 110m land, see src/data/landmask.json).
 * A* where a water cell costs WATER_COST times a land cell, so the bird follows coasts and land bridges
 * and only crosses open water when going around is more than WATER_COST times longer.
 */
const ROWS = 180
const COLS = 360
const WATER_COST = 3
const isLand = (r: number, c: number) => (mask as string[])[r][c] === '1'
const cellOf = ([lat, lng]: Pt): [number, number] => [
  Math.min(ROWS - 1, Math.max(0, Math.floor(90 - lat))),
  (((Math.floor(lng + 180) % COLS) + COLS) % COLS),
]
const centre = (r: number, c: number): Pt => [89.5 - r, c - 179.5]

class Heap {
  private a: [number, number][] = []
  get size() { return this.a.length }
  push(item: [number, number]) {
    const a = this.a
    a.push(item)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p][0] <= a[i][0]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): [number, number] {
    const a = this.a
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l][0] < a[m][0]) m = l
        if (r < a.length && a[r][0] < a[m][0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

function chaikin(pts: Pt[], rounds: number): Pt[] {
  let p = pts
  for (let k = 0; k < rounds; k++) {
    const out: Pt[] = [p[0]]
    for (let i = 0; i < p.length - 1; i++) {
      const [a, b] = [p[i], p[i + 1]]
      // longitudes are unwrapped by the caller, so plain interpolation is safe
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]])
    }
    out.push(p[p.length - 1])
    p = out
  }
  return p
}

/** [lat, lng] points from `from` to `to`; longitudes are continuous (may exceed +-180) so the map line never jumps. */
export function landRoute(from: Pt, to: Pt): Pt[] {
  const [sr, sc] = cellOf(from)
  const [gr, gc] = cellOf(to)
  const goal = gr * COLS + gc
  const start = sr * COLS + sc
  if (start === goal) return [from, to]

  const g = new Float64Array(ROWS * COLS).fill(Infinity)
  const prev = new Int32Array(ROWS * COLS).fill(-1)
  const open = new Heap()
  const h = (r: number, c: number) => haversineKm({ lat: centre(r, c)[0], lng: centre(r, c)[1] }, { lat: to[0], lng: to[1] })
  g[start] = 0
  open.push([h(sr, sc), start])

  while (open.size) {
    const [, n] = open.pop()
    if (n === goal) break
    const r = Math.floor(n / COLS)
    const c = n % COLS
    const base = g[n]
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue
        const nr = r + dr
        if (nr < 0 || nr >= ROWS) continue
        const nc = (c + dc + COLS) % COLS
        const m = nr * COLS + nc
        const [la, ln] = centre(r, c)
        const [lb, lm] = centre(nr, nc)
        const step = haversineKm({ lat: la, lng: ln }, { lat: lb, lng: lm }) * (isLand(nr, nc) || m === goal ? 1 : WATER_COST)
        if (base + step < g[m]) {
          g[m] = base + step
          prev[m] = n
          open.push([g[m] + h(nr, nc), m])
        }
      }
    }
  }

  const cells: number[] = []
  for (let n = goal; n !== -1; n = prev[n]) cells.push(n)
  if (cells[cells.length - 1] !== start) return [from, to] // unreachable: should not happen on a connected grid
  cells.reverse()

  const pts: Pt[] = [from]
  let lastLng = from[1]
  for (const n of cells.slice(1, -1)) {
    const [lat, lng] = centre(Math.floor(n / COLS), n % COLS)
    const k = Math.round((lastLng - lng) / 360) // unwrap across the antimeridian
    pts.push([lat, lng + 360 * k])
    lastLng = lng + 360 * k
  }
  const k = Math.round((lastLng - to[1]) / 360)
  pts.push([to[0], to[1] + 360 * k])
  return chaikin(pts, 2)
}
