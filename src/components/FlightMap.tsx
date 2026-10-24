import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap, GeoJSONSource, StyleSpecification } from 'maplibre-gl'
import { easeBearing, pointAtKm, routeLengthKm, shortestAngleDelta, type Pt } from '../lib/geo'
import { MAP_STYLE } from './MiniMap'

type Props = {
  route: Pt[]
  /** Route km of each stop still ahead (the last one is the destination). */
  stops: number[]
  /** Called every frame; must be cheap and return the km travelled along the route. */
  getKm: () => number
  /** Written every frame: route bearing minus displayed map bearing, degrees (positive = route turns clockwise). */
  turnRef?: { current: number }
  className?: string
}

/** Plain base used when the vector style cannot load; the journey layers are added on top either way. */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#efe7e1' } },
    { id: 'osm', type: 'raster', source: 'osm' },
  ],
}

const MIN_ZOOM = 3
const MAX_ZOOM = 11
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
/** Survives map rebuilds (route/stops change). */
let chosenZoom = 6

const line = (pts: Pt[]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: pts.map(([lat, lng]) => [lng, lat]) },
})

/** Tilted map that follows the bird along the route. The bird itself is a separate overlay at screen centre. */
export default function FlightMap({ route, stops, getKm, turnRef, className = '' }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const kmRef = useRef(getKm)
  kmRef.current = getKm
  const stopsKey = stops.join(',')
  const nudge = useRef<(d: number) => void>(() => {})
  const [limit, setLimit] = useState(0) // -1 at min zoom, 1 at max

  useEffect(() => {
    let raf = 0
    let map: MapLibreMap | null = null
    let cancelled = false
    let stopTimer = () => {}
    let removeZoomListeners = () => {}
    const markers: { remove: () => void }[] = []
    ;(async () => {
      const [maplibregl] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
      if (cancelled || !el.current) return
      const start = pointAtKm(route, kmRef.current())
      try {
        map = new maplibregl.Map({
          container: el.current,
          style: MAP_STYLE,
          center: [start.pt[1], start.pt[0]],
          zoom: clampZoom(chosenZoom),
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
          pitch: 55,
          bearing: start.bearing,
          interactive: true,
          attributionControl: { compact: true },
        })
      } catch {
        return // WebGL unavailable: the paper-coloured background stays
      }
      const m = map
      // Only zoom stays on: the bird must stay centred, so no pan/rotate/pitch/keys.
      m.dragPan.disable()
      m.dragRotate.disable()
      m.keyboard.disable()
      m.touchPitch.disable()
      m.doubleClickZoom.disable()
      m.scrollZoom.disable() // jumpTo below cancels maplibre's own eased zoom, so wheel/buttons feed `target` instead
      m.touchZoomRotate.enable({ around: 'center' })
      m.touchZoomRotate.disableRotation()
      let target = clampZoom(chosenZoom)
      let cur = target
      nudge.current = (d) => (target = clampZoom(Math.round(target) + d))
      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        target = clampZoom(target - e.deltaY * (e.deltaMode ? 0.05 : 0.004))
      }
      const box = el.current
      box.addEventListener('wheel', onWheel, { passive: false })
      const onZoomEnd = () => {
        chosenZoom = clampZoom(m.getZoom())
        setLimit(chosenZoom <= MIN_ZOOM + 0.01 ? -1 : chosenZoom >= MAX_ZOOM - 0.01 ? 1 : 0)
      }
      m.on('zoomend', onZoomEnd)
      removeZoomListeners = () => {
        box.removeEventListener('wheel', onWheel)
        nudge.current = () => {}
      }
      const addJourney = () => {
        if (m.getSource('route')) return // guards repeat style.load events
        m.addSource('route', { type: 'geojson', data: line(route) as never })
        m.addSource('done', { type: 'geojson', data: line([route[0]]) as never })
        m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#446650', 'line-width': 4, 'line-dasharray': [0.1, 2] } })
        m.addLayer({ id: 'done', type: 'line', source: 'done', paint: { 'line-color': '#7fa38a', 'line-width': 5, 'line-opacity': 0.9 } })
      }
      let styleReady = false
      let fellBack = false
      const fallBack = () => {
        if (fellBack) return
        fellBack = true
        m.setStyle(FALLBACK_STYLE, { diff: false }) // diff needs a loaded style, which the failed one never was
      }
      m.on('style.load', () => {
        styleReady = true
        addJourney()
      })
      // Style-level failures only: tile errors carry a sourceId and must not swap the style.
      m.on('error', (e) => {
        if (!styleReady && !(e as { sourceId?: string }).sourceId) fallBack()
      })
      const timer = window.setTimeout(() => !styleReady && fallBack(), 4000)
      stopTimer = () => window.clearTimeout(timer)

      const len = routeLengthKm(route)
      const dot = (label: string) => {
        const d = document.createElement('div')
        d.textContent = label
        d.style.cssText = 'width:20px;height:20px;border-radius:50%;border:2px solid #446650;background:#fff;color:#446650;font:700 11px/16px sans-serif;text-align:center'
        return d
      }
      const marks = [
        { km: 0, el: dot('A') },
        ...stops.filter((km) => km < len - 1).map((km, i) => ({ km, el: dot(String(i + 1)) })),
        { km: len, el: dot('B') },
      ]
      marks.forEach(({ km, el }) => {
        const pt = pointAtKm(route, km).pt
        markers.push(new maplibregl.Marker({ element: el }).setLngLat([pt[1], pt[0]]).addTo(m))
      })
      const markReached = (km: number) =>
        marks.forEach(({ km: at, el }) => {
          const hit = at <= km
          el.style.background = hit ? '#446650' : '#fff'
          el.style.color = hit ? '#fff' : '#446650'
        })

      let lastSplit = 0
      let shown = start.bearing
      let lastNow = 0
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick)
        const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.1) : 0
        lastNow = now
        const km = kmRef.current()
        const { pt, bearing, index } = pointAtKm(route, km)
        shown = easeBearing(shown, bearing, dt, 90)
        if (turnRef) turnRef.current = shortestAngleDelta(shown, bearing)
        if (Math.abs(m.getZoom() - cur) > 0.001) cur = target = m.getZoom() // pinch moved it
        else cur += (target - cur) * Math.min(1, dt * 12) || 0
        if (Math.abs(target - cur) < 0.005) cur = target
        m.jumpTo({ center: [pt[1], pt[0]], bearing: shown, ...(cur !== m.getZoom() && { zoom: cur }) })
        if (now - lastSplit > 500 && m.getSource('done')) {
          lastSplit = now
          markReached(km)
          ;(m.getSource('done') as GeoJSONSource).setData(line([...route.slice(0, index), pt]) as never)
        }
      }
      raf = requestAnimationFrame(tick)
    })()
    return () => {
      cancelled = true
      stopTimer()
      removeZoomListeners()
      markers.forEach((k) => k.remove())
      cancelAnimationFrame(raf)
      map?.remove()
    }
  }, [route, stopsKey, turnRef])

  return (
    <div className={`bg-[#efe7e1] ${className}`}>
      <div ref={el} style={{ width: '100%', height: '100%' }} />
      <div className="absolute right-4 top-[62%] z-10 flex -translate-y-1/2 flex-col gap-2">
        {[
          { label: 'Zoom in', sign: '+', d: 1, off: limit === 1 },
          { label: 'Zoom out', sign: '−', d: -1, off: limit === -1 },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            aria-label={b.label}
            disabled={b.off}
            onClick={() => nudge.current(b.d)}
            className="flex size-11 items-center justify-center rounded-full bg-white/90 text-[22px] font-semibold leading-none text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px] disabled:opacity-40"
          >
            {b.sign}
          </button>
        ))}
      </div>
    </div>
  )
}
