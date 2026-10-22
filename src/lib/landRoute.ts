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
const LAND = Uint8Array.from((mask as string[]).join(''), (ch) => (ch === '1' ? 1 : 0))
const isLand = (n: number) => LAND[n] === 1
const cellOf = ([lat, lng]: Pt): [number, number] => [
  Math.min(ROWS - 1, Math.max(0, Math.floor(90 - lat))),
  (((Math.floor(lng + 180) % COLS) + COLS) % COLS),
]
const centre = (r: number, c: number): Pt => [89.5 - r, c - 179.5]
// km from a cell in row r to its neighbour (dr, dc); depends only on the row, so it is computed once
const STEP = Array.from({ length: ROWS }, (_, r) =>
  [-1, 0, 1].map((dr) => [-1, 0, 1].map((dc) => (r + dr < 0 || r + dr >= ROWS ? 0 : haversineKm({ lat: 89.5 - r, lng: 0 }, { lat: 89.5 - r - dr, lng: dc })))),
)
const stepKm = (r: number, dr: number, dc: number) => STEP[r][dr + 1][dc + 1]

/** Binary min-heap of (key, cell) in typed arrays: no per-push allocation, which dominates a whole-grid search. */
class Heap {
  private k = new Float64Array(1024)
  private v = new Int32Array(1024)
  size = 0
  /** key of the entry the last pop() returned */
  key = 0
  push(key: number, val: number) {
    if (this.size === this.k.length) {
      const k = new Float64Array(this.size * 2)
      const v = new Int32Array(this.size * 2)
      k.set(this.k)
      v.set(this.v)
      this.k = k
      this.v = v
    }
    const { k, v } = this
    let i = this.size++
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]
      v[i] = v[p]
      i = p
    }
    k[i] = key
    v[i] = val
  }
  pop(): number {
    const { k, v } = this
    const top = v[0]
    this.key = k[0]
    const n = --this.size
    const key = k[n]
    const val = v[n]
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      if (l >= n) break
      const m = l + 1 < n && k[l + 1] < k[l] ? l + 1 : l
      if (k[m] >= key) break
      k[i] = k[m]
      v[i] = v[m]
      i = m
    }
    k[i] = key
    v[i] = val
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
  const hc = new Float64Array(ROWS * COLS).fill(-1) // heuristic, computed once per cell
  const prev = new Int32Array(ROWS * COLS).fill(-1)
  const open = new Heap()
  const h = (n: number) => {
    if (hc[n] < 0) {
      const [la, ln] = centre(Math.floor(n / COLS), n % COLS)
      hc[n] = haversineKm({ lat: la, lng: ln }, { lat: to[0], lng: to[1] })
    }
    return hc[n]
  }
  g[start] = 0
  open.push(h(start), start)

  while (open.size) {
    const n = open.pop()
    if (n === goal) break
    if (open.key > g[n] + hc[n] + 1e-6) continue // stale entry: this cell was reached more cheaply since
    const r = Math.floor(n / COLS)
    const c = n % COLS
    const base = g[n]
    for (let dr = -1; dr <= 1; dr++) {
      const nr = r + dr
      if (nr < 0 || nr >= ROWS) continue
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue
        const nc = (c + dc + COLS) % COLS
        const m = nr * COLS + nc
        const step = stepKm(r, dr, dc) * (isLand(m) || m === goal ? 1 : WATER_COST)
        if (base + step < g[m]) {
          g[m] = base + step
          prev[m] = n
          open.push(g[m] + h(m), m)
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
