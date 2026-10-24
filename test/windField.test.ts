import { describe, expect, it } from 'vitest'
import { windOnScreen } from '../src/lib/windField'

const w = (fromDeg: number, speedKmh = 20) => ({ fromDeg, speedKmh, tempC: 10 })

describe('windOnScreen', () => {
  it('headwind runs down the screen', () => {
    const r = windOnScreen(w(0), 0)
    expect(r.dy).toBeGreaterThan(0.99)
    expect(Math.abs(r.dx)).toBeLessThan(0.01)
  })
  it('tailwind runs up', () => expect(windOnScreen(w(180), 0).dy).toBeLessThan(-0.99))
  it('wind from the west runs right', () => expect(windOnScreen(w(270), 0).dx).toBeGreaterThan(0.99))
  it('rotates with the heading and stays a unit vector', () => {
    expect(windOnScreen(w(90), 90).dy).toBeGreaterThan(0.99)
    for (const [f, h] of [[13, 200], [301, 77], [180, 359], [45, 45]]) {
      const r = windOnScreen(w(f), h)
      expect(Math.abs(Math.hypot(r.dx, r.dy) - 1)).toBeLessThan(1e-9)
    }
  })
  it('count and speed scale and cap', () => {
    expect(windOnScreen(w(0, 0), 0).count).toBe(0)
    expect(windOnScreen(w(0, 20), 0).count).toBe(60)
    expect(windOnScreen(w(0, 500), 0).count).toBe(120)
    expect(windOnScreen(w(0, 30), 0).pxPerSec).toBeGreaterThan(windOnScreen(w(0, 10), 0).pxPerSec)
    expect(windOnScreen(w(0, 500), 0).pxPerSec).toBe(420)
  })
})
