import { describe, expect, it } from 'vitest'
import { stopsAhead } from '../src/lib/stops'

describe('stopsAhead', () => {
  it.each([
    [1000, 0, 4, [400, 800, 1000]],
    [1000, 1000, 25, []],
    [200, 0, 25, [200]],
    [2500, 0, 25, [2500]],
    [4999.7, 0, 25, [2500, 4999.7]],
    [5000, 1200, 25, [3700, 5000]],
    [1000, 0, 0, [1000]],
  ])('stopsAhead(%f, %f, %f)', (route, from, slot, want) => {
    expect(stopsAhead(route, from, slot)).toEqual(want)
  })
})
