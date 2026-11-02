import { api } from './api'
import { COGNITO_CONFIGURED } from './auth'

const ARROWS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export type Wind = { speedKmh: number; fromDeg: number; tempC: number }

/**
 * Current wind and temperature at a point. Through `GET /weather` when signed-in builds are configured (the server holds
 * the Open-Meteo key and caches per 0.1 degree cell, so the coordinates leave the device rounded to 1 decimal);
 * offline dev without Cognito calls Open-Meteo's free endpoint directly. Null on any failure.
 */
export async function windAt(lat: number, lng: number): Promise<Wind | null> {
  try {
    if (COGNITO_CONFIGURED) return await api<Wind>(`/weather?lat=${lat.toFixed(1)}&lng=${lng.toFixed(1)}`)
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}&current=temperature_2m,wind_speed_10m,wind_direction_10m`)
    if (!r.ok) return null
    const c = (await r.json()).current
    return { speedKmh: c.wind_speed_10m, fromDeg: c.wind_direction_10m, tempC: c.temperature_2m }
  } catch {
    return null
  }
}

/** Compares the wind with the bird's heading ("tailwind", "headwind", "crosswind") for the little map note. */
export function windNote(w: Wind, headingDeg: number): string {
  const rel = Math.cos(((w.fromDeg + 180 - headingDeg) * Math.PI) / 180) // +1 = blowing the way we fly
  const kind = w.speedKmh < 6 ? 'calm air' : rel > 0.4 ? 'tailwind' : rel < -0.4 ? 'headwind' : 'crosswind'
  const from = ARROWS[Math.round(w.fromDeg / 45) % 8]
  return w.speedKmh < 6 ? `${kind}, ${Math.round(w.tempC)}°C` : `${kind} ${Math.round(w.speedKmh)} km/h from ${from}`
}
