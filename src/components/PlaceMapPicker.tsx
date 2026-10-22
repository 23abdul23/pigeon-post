import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap, Marker } from 'maplibre-gl'
import Flag from './Flag'
import { MAP_STYLE } from './MiniMap'
import type { Pt } from '../lib/geo'
import { placeLabel, reversePlace, type PlaceKind, type ReverseResult } from '../lib/places'
import type { Place } from '../lib/store'

type Props = {
  initial?: Pt
  onPick: (p: Place) => void
  onClose: () => void
  /** 'city' for home (city level only), 'any' for destinations */
  kind?: PlaceKind
}

/** Tap the map to drop a pin and name the spot; nothing is chosen until Confirm. The search box stays the keyboard path. */
export default function PlaceMapPicker({ initial, onPick, onClose, kind = 'any' }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const [found, setFound] = useState<ReverseResult | 'looking' | null>(null)
  const [noMap, setNoMap] = useState(false)

  useEffect(() => {
    let map: MapLibreMap | null = null
    let marker: Marker | null = null
    let cancelled = false
    let tap = 0
    ;(async () => {
      const [maplibregl] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
      if (cancelled || !el.current) return
      try {
        map = new maplibregl.Map({
          container: el.current,
          style: MAP_STYLE,
          center: initial ? [initial[1], initial[0]] : [0, 20],
          zoom: initial ? 4 : 1,
          attributionControl: false,
        })
      } catch {
        setNoMap(true) // WebGL unavailable: the search box still works
        return
      }
      const m = map
      // expanded (not the compact "i") so the OpenStreetMap credit is always visible on the picker
      m.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: '© OpenStreetMap contributors' }))
      m.on('click', async (e) => {
        marker ??= new maplibregl.Marker({ color: '#8e4d31' })
        marker.setLngLat(e.lngLat).addTo(m)
        const { lat, lng } = e.lngLat.wrap() // a tap on a repeated world copy can be past +-180
        const id = ++tap
        setFound('looking')
        const r = await reversePlace(lat, lng, kind) // rounds before anything leaves the device
        if (!cancelled && id === tap) setFound(r)
      })
    })()
    return () => {
      cancelled = true
      map?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const result = found && found !== 'looking' ? found : null

  return (
    <div className="mt-2 overflow-hidden rounded-xl bg-white shadow-[0_8px_24px_-4px_rgba(62,58,54,0.12)]">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.6px] text-sky-ink">Tap the map to drop a pin</span>
        <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-[12px] font-bold tracking-[0.36px] text-[#8e4d31]">
          Close map
        </button>
      </div>
      <div className="relative h-64 bg-[#efe7e1]" role="region" aria-label="Map for choosing a place. You can also type in the search box.">
        {/* maplibre's stylesheet sets position:relative on its container, so the box is sized by a wrapper */}
        <div className="absolute inset-0">
          <div ref={el} style={{ width: '100%', height: '100%' }} />
        </div>
        {noMap && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-[14px] text-ink-2">The map can't load on this device. Use the search box instead.</p>}
      </div>
      <div className="px-3 py-2.5" aria-live="polite">
        {!found && <p className="text-[14px] text-ink-2">No pin yet.</p>}
        {found === 'looking' && <p className="text-[14px] text-ink-2">Looking up that spot…</p>}
        {result && !result.place && <p className="text-[14px] text-ink-2">No place here — try land.</p>}
        {result?.place && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <Flag cc={result.place.cc} className="w-5" />
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-ink">{placeLabel(result.place)}</span>
                {result.approxKm !== undefined && result.approxKm > 50 && (
                  <span className="block text-[12px] text-muted">Nearest city, about {Math.round(result.approxKm).toLocaleString('en-US')} km away</span>
                )}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onPick(result.place!)}
              className="shrink-0 rounded-full bg-sage px-4 py-2 text-[13px] font-bold tracking-[0.28px] text-white"
            >
              Confirm
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
