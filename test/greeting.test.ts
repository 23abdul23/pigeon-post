import { describe, expect, it } from 'vitest'
import { greeting } from '../src/lib/greeting'

// Dates are built from local-time components, so these hold in any timezone the tests run in.
const at = (h: number, m = 0) => greeting(new Date(2026, 9, 24, h, m))

describe('greeting', () => {
  it.each([
    [0, 'Good Night'],
    [4, 'Good Night'],
    [5, 'Good Morning'],
    [11, 'Good Morning'],
    [12, 'Good Afternoon'],
    [16, 'Good Afternoon'],
    [17, 'Good Evening'],
    [21, 'Good Evening'],
    [22, 'Good Night'],
    [23, 'Good Night'],
  ])('at %i:00 says %s', (h, text) => expect(at(h)).toBe(text))

  it('switches exactly on the hour', () => {
    expect(at(11, 59)).toBe('Good Morning')
    expect(at(12, 0)).toBe('Good Afternoon')
  })
})
