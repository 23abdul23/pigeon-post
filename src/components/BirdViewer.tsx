import { useEffect, useRef } from 'react'
import type { BirdSpecies } from '../lib/birds'

type Props = { bird: BirdSpecies; className?: string; flight?: boolean; /** Degrees the route ahead turns clockwise from the map heading; the bird yaws and banks toward it. */ turnRef?: { current: number } }

/** Drag-to-rotate 3D bird. three.js loads on demand. */
export default function BirdViewer({ bird, className = '', flight = false, turnRef }: Props) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    let cleanup = () => {}
    let cancelled = false
    ;(async () => {
      const THREE = await import('three')
      const { buildBird } = await import('../lib/birdModel')
      const el = host.current
      if (cancelled || !el) return
      const view = el.ownerDocument.defaultView ?? window // the popup is another window: its frames keep coming while this tab is hidden
      let renderer: InstanceType<typeof THREE.WebGLRenderer>
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      } catch {
        return // no WebGL: the empty tile stays as the fallback
      }
      renderer.setPixelRatio(Math.min(view.devicePixelRatio, 2))
      el.appendChild(renderer.domElement)
      renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:pan-y;cursor:grab'

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50)
      if (flight) {
        // behind and above the bird, matching the map's tilted camera
        camera.position.set(0, 3.4, -4.6)
        camera.lookAt(0, 0, 0.5)
      } else {
        camera.position.set(0, 1.1, 4.2)
        camera.lookAt(0, 0, 0)
      }
      scene.add(new THREE.AmbientLight(0xffffff, 1.4))
      const sun = new THREE.DirectionalLight(0xfff2dd, 2.2)
      sun.position.set(2, 4, 3)
      scene.add(sun)

      let rig: Awaited<ReturnType<typeof buildBird>>
      try {
        rig = await buildBird(bird)
      } catch {
        renderer.dispose()
        renderer.domElement.remove()
        return // model failed to load: the empty tile stays as the fallback
      }
      if (cancelled) {
        renderer.dispose()
        renderer.domElement.remove()
        return
      }
      rig.group.rotation.set(flight ? 0 : 0.15, flight ? 0 : -0.6, 0)
      scene.add(rig.group)

      const size = () => {
        const w = el.clientWidth || 1
        const h = el.clientHeight || 1
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      }
      size()
      const ro = new ResizeObserver(size)
      ro.observe(el)

      let dragging = false
      let lastX = 0
      let idle = true
      const down = (e: PointerEvent) => {
        dragging = true
        idle = false
        lastX = e.clientX
        renderer.domElement.setPointerCapture(e.pointerId)
        renderer.domElement.style.cursor = 'grabbing'
      }
      const move = (e: PointerEvent) => {
        if (!dragging) return
        rig.group.rotation.y += (e.clientX - lastX) * 0.012
        lastX = e.clientX
      }
      const up = () => {
        dragging = false
        renderer.domElement.style.cursor = 'grab'
      }
      if (!flight) {
        renderer.domElement.addEventListener('pointerdown', down)
        renderer.domElement.addEventListener('pointermove', move)
        renderer.domElement.addEventListener('pointerup', up)
        renderer.domElement.addEventListener('pointercancel', up)
      } else {
        renderer.domElement.style.cursor = 'default'
        idle = false
      }

      const clock = new THREE.Clock()
      let t = 0
      const loop = () => {
        raf = view.requestAnimationFrame(loop)
        const dt = Math.min(clock.getDelta(), 0.05)
        t += dt
        rig.update(dt)
        if (flight) {
          const turn = Math.max(-35, Math.min(35, turnRef?.current ?? 0)) * (Math.PI / 180)
          rig.group.rotation.y = -turn // +Z is up-screen and +X screen-left, so a clockwise route turn is negative yaw
          rig.group.rotation.z = Math.sin(t * 0.9) * 0.08 + turn * 0.6 // roll into the turn (right wing down for a right turn)
        }
        if (idle) rig.group.rotation.y += 0.006
        renderer.render(scene, camera)
      }
      loop()

      cleanup = () => {
        view.cancelAnimationFrame(raf)
        ro.disconnect()
        rig.dispose()
        renderer.dispose()
        renderer.domElement.remove()
      }
    })()
    return () => {
      cancelled = true
      cleanup()
    }
  }, [bird, flight, turnRef])

  return <div ref={host} role="img" aria-label="Rotatable 3D bird preview" className={className} />
}
