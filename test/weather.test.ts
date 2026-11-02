import { afterEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ cognito: true }))
vi.mock('../src/lib/auth', () => ({
  get COGNITO_CONFIGURED() {
    return flags.cognito
  },
}))
vi.mock('../src/lib/api', async (orig) => ({ ...(await orig<typeof import('../src/lib/api')>()), api: vi.fn() }))

import { api, ApiError } from '../src/lib/api'
import { windAt } from '../src/lib/weather'

const apiMock = vi.mocked(api)
const wind = { speedKmh: 12, fromDeg: 270, tempC: 9 }

afterEach(() => {
  apiMock.mockReset()
  flags.cognito = true
  vi.unstubAllGlobals()
})

describe('windAt', () => {
  it('windAt_uses_the_api_when_COGNITO_configured', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    apiMock.mockResolvedValue(wind)
    expect(await windAt(48.8566, 2.3522)).toEqual(wind)
    expect(apiMock.mock.calls[0][0]).toBe('/weather?lat=48.9&lng=2.4')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('windAt_returns_null_on_failure', async () => {
    apiMock.mockRejectedValue(new ApiError(502, 'bad gateway'))
    expect(await windAt(1, 2)).toBeNull()
    apiMock.mockRejectedValue(new TypeError('offline'))
    expect(await windAt(1, 2)).toBeNull()
  })

  it('windAt_calls_open_meteo_directly_without_cognito', async () => {
    flags.cognito = false
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ current: { temperature_2m: 9, wind_speed_10m: 12, wind_direction_10m: 270 } })))
    vi.stubGlobal('fetch', fetchSpy)
    expect(await windAt(48.8566, 2.3522)).toEqual(wind)
    expect(apiMock).not.toHaveBeenCalled()
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.open-meteo.com')
  })
})
