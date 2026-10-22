import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/outbox', () => ({ send: vi.fn() }))

import { send } from '../src/lib/outbox'
import { getState, setState, type City, type Place } from '../src/lib/store'
import { createTrip, TripError } from '../src/lib/trips'

const zagreb: City = { name: 'Zagreb', country: 'Croatia', cc: 'HR', lat: 45.81, lng: 15.98 }
const place = (lat: number, lng: number): Place => ({ id: `p-${lat}`, name: 'Spot', country: 'Croatia', cc: 'HR', lat, lng })

afterEach(() => setState({ homeCity: null, trip: null }))

describe('createTrip', () => {
  it('create_trip_rejects_destination_closer_than_50km_to_home_with_message', () => {
    setState({ homeCity: zagreb, trip: null })
    const near = place(45.9, 16.2) // about 20 km away
    let err: unknown
    try {
      createTrip(near)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(TripError)
    expect((err as TripError).message).toBe('That is too close to home to send a bird. Pick somewhere farther away.')
    expect(getState().trip).toBeNull()
    expect(send).not.toHaveBeenCalled()

    expect(() => createTrip(place(45.81, 15.98))).toThrow(TripError) // home itself
    const far = createTrip(place(45.33, 14.44)) // Rijeka, about 130 km
    expect(far.routeKm).toBeGreaterThan(100)
  })
})
