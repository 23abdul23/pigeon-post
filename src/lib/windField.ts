import type { Wind } from './weather'

/** Screen-space drift of wind particles: screen up is the bird's heading; wind blows toward fromDeg + 180. */
export function windOnScreen(w: Wind, headingDeg: number) {
  const a = ((w.fromDeg + 180 - headingDeg) * Math.PI) / 180
  return {
    dx: Math.sin(a),
    dy: -Math.cos(a),
    pxPerSec: Math.min(420, 40 + w.speedKmh * 8),
    count: Math.min(120, Math.round(w.speedKmh * 3)),
  }
}
