import { useEffect, useRef } from 'react'
import { windOnScreen } from '../lib/windField'
import type { Wind } from '../lib/weather'

type Props = { wind: { w: Wind; heading: number } | null }
type P = { x: number; y: number; life: number }

/** Drifting white streaks showing the live wind relative to the bird's heading. */
export default function WindStreaks({ wind }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const windRef = useRef(wind)
  windRef.current = wind
  const active = !!wind && windOnScreen(wind.w, wind.heading).count > 0

  useEffect(() => {
    const cv = ref.current
    if (!active || !cv || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const g = cv.getContext('2d')
    if (!g) return
    let W = 0, H = 0, raf = 0, last = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const size = () => {
      W = cv.clientWidth
      H = cv.clientHeight
      cv.width = W * dpr
      cv.height = H * dpr
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(cv)
    const ps: P[] = []
    const spawn = (anywhere: boolean, dx: number, dy: number): P => {
      if (anywhere) return { x: Math.random() * W, y: Math.random() * H, life: Math.random() }
      // upwind edge: opposite the drift direction
      const alongX = Math.abs(dx) > Math.abs(dy) && Math.random() < Math.abs(dx) / (Math.abs(dx) + Math.abs(dy))
      return alongX ? { x: dx > 0 ? 0 : W, y: Math.random() * H, life: 1 } : { x: Math.random() * W, y: dy > 0 ? 0 : H, life: 1 }
    }
    const frame = (t: number) => {
      if (document.hidden) return // the visibilitychange handler restarts the loop
      const cur = windRef.current
      const dt = Math.min(0.1, (t - last) / 1000 || 0)
      last = t
      g.clearRect(0, 0, W, H)
      if (cur) {
        const { dx, dy, pxPerSec, count } = windOnScreen(cur.w, cur.heading)
        while (ps.length < count) ps.push(spawn(true, dx, dy))
        ps.length = Math.min(ps.length, count)
        const len = pxPerSec / 12
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i]
          p.x += dx * pxPerSec * dt
          p.y += dy * pxPerSec * dt
          p.life -= dt * 0.25
          if (p.life <= 0 || p.x < -len || p.x > W + len || p.y < -len || p.y > H + len) {
            ps[i] = spawn(false, dx, dy)
            continue
          }
          g.globalAlpha = Math.min(1, p.life * 2)
          g.strokeStyle = 'rgba(79, 148, 245, 0.55)'
          g.lineWidth = 1.5
          g.beginPath()
          g.moveTo(p.x, p.y)
          g.lineTo(p.x - dx * len, p.y - dy * len)
          g.stroke()
        }
        g.globalAlpha = 1
      }
      raf = requestAnimationFrame(frame)
    }
    const onVis = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden) raf = requestAnimationFrame(frame)
    }
    document.addEventListener('visibilitychange', onVis)
    onVis()
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
    }
  }, [active])

  return active ? <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" /> : null
}
