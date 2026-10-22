import { useEffect, useRef } from 'react'
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import { pointAtKm, type Pt } from '../lib/geo'
import { MAP_STYLE } from './MiniMap'

type Props = {
  route: Pt[]
  /** Called every frame; must be cheap and return the km travelled along the route. */
  getKm: () => number
  className?: string
}

const line = (pts: Pt[]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: pts.map(([lat, lng]) => [lng, lat]) },
})

/** Tilted map that follows the bird along the route. The bird itself is a separate overlay at screen centre. */
export default function FlightMap({ route, getKm, className = '' }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const kmRef = useRef(getKm)
  kmRef.current = getKm

  useEffect(() => {
    let raf = 0
    let map: MapLibreMap | null = null
    let cancelled = false
    ;(async () => {
      const [maplibregl] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
      if (cancelled || !el.current) return
      const start = pointAtKm(route, kmRef.current())
      try {
        map = new maplibregl.Map({
          container: el.current,
          style: MAP_STYLE,
          center: [start.pt[1], start.pt[0]],
          zoom: 7,
          pitch: 55,
          bearing: start.bearing,
          interactive: false,
          attributionControl: { compact: true },
        })
      } catch {
        return // WebGL unavailable: the paper-coloured background stays
      }
      const m = map
      m.on('load', () => {
        m.addSource('done', { type: 'geojson', data: line([route[0]]) as never })
        m.addSource('ahead', { type: 'geojson', data: line(route) as never })
        m.addLayer({ id: 'ahead', type: 'line', source: 'ahead', paint: { 'line-color': '#446650', 'line-width': 3, 'line-dasharray': [1.5, 2], 'line-opacity': 0.8 } })
        m.addLayer({ id: 'done', type: 'line', source: 'done', paint: { 'line-color': '#7fa38a', 'line-width': 5, 'line-opacity': 0.9 } })
      })

      let lastSplit = 0
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick)
        const km = kmRef.current()
        const { pt, bearing, index } = pointAtKm(route, km)
        m.jumpTo({ center: [pt[1], pt[0]], bearing })
        if (now - lastSplit > 500 && m.getSource('done')) {
          lastSplit = now
          ;(m.getSource('done') as GeoJSONSource).setData(line([...route.slice(0, index), pt]) as never)
          ;(m.getSource('ahead') as GeoJSONSource).setData(line([pt, ...route.slice(index)]) as never)
        }
      }
      raf = requestAnimationFrame(tick)
    })()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      map?.remove()
    }
  }, [route])

  return (
    <div className={`bg-[#efe7e1] ${className}`}>
      <div ref={el} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
