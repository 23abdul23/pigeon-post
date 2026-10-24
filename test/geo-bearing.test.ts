import { describe, expect, it } from 'vitest'
import { easeBearing, shortestAngleDelta } from '../src/lib/geo'

describe('bearing easing', () => {
  it('takes the short way across 0/360', () => {
    expect(shortestAngleDelta(350, 10)).toBe(20)
    expect(shortestAngleDelta(10, 350)).toBe(-20)
    expect(shortestAngleDelta(0, 180)).toBe(180)
  })
  it('limits the step per frame and wraps', () => {
    expect(easeBearing(355, 90, 0.1, 90)).toBeCloseTo(4)
    expect(easeBearing(10, 300, 0.1, 90)).toBeCloseTo(1)
  })
  it('converges without overshoot', () => {
    let b = 20
    for (let i = 0; i < 200; i++) b = easeBearing(b, 100, 1 / 60, 90)
    expect(b).toBeCloseTo(100)
  })
})
