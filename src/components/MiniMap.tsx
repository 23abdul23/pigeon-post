import { useEffect, useRef, type ReactNode } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

type Props = {
  center: { lat: number; lng: number }
  zoom?: number
  className?: string
  children?: ReactNode
}

/** Non-interactive preview map. maplibre-gl is loaded on demand to keep the first bundle small. */
export default function MiniMap({ center, zoom = 10, className = '', children }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [maplibregl] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
      if (cancelled || !el.current) return
      try {
        map.current = new maplibregl.Map({
          container: el.current,
          style: MAP_STYLE,
          center: [center.lng, center.lat],
          zoom,
          interactive: false,
          attributionControl: { compact: true },
        })
      } catch {
        // WebGL unavailable: the tinted background stays as the fallback
      }
    })()
    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    map.current?.easeTo({ center: [center.lng, center.lat], zoom, duration: 600 })
  }, [center.lat, center.lng, zoom])

  return (
    <div className={`relative overflow-hidden bg-[#efe7e1] ${className}`}>
      {/* maplibre's stylesheet sets position:relative on its container, so the box is sized by a wrapper */}
      <div className="absolute inset-0 opacity-90">
        <div ref={el} style={{ width: '100%', height: '100%' }} />
      </div>
      {children}
    </div>
  )
}
