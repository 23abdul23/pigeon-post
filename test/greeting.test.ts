import { describe, expect, it } from 'vitest'
import { greeting } from '../src/lib/greeting'

// Dates are built from local-time components, so these hold in any timezone the tests run in.
const at = (h: number, m = 0) => greeting(new Date(2026, 9, 24, h, m))

describe('greeting', () => {
  it.each([
    [0, 'Good night'],
    [4, 'Good night'],
    [5, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [16, 'Good afternoon'],
    [17, 'Good evening'],
    [21, 'Good evening'],
    [22, 'Good night'],
    [23, 'Good night'],
  ])('at %i:00 says %s', (h, text) => expect(at(h)).toBe(text))

  it('switches exactly on the hour', () => {
    expect(at(11, 59)).toBe('Good morning')
    expect(at(12, 0)).toBe('Good afternoon')
  })
})
