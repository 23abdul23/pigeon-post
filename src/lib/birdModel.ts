import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { BirdSpecies } from './birds'

export type BirdRig = { group: THREE.Group; update: (dt: number) => void; dispose: () => void }

type Gltf = Awaited<ReturnType<GLTFLoader['loadAsync']>>
const loader = new GLTFLoader()
const cache = new Map<string, Promise<Gltf>>()

const load = (url: string) => {
  let p = cache.get(url)
  if (!p) {
    p = loader.loadAsync(url)
    cache.set(url, p)
  }
  return p
}

/** Centre the model and scale its longest side to 2 units. */
function normalise(model: THREE.Object3D, yaw = 0, zoom = 1): THREE.Group {
  model.updateMatrixWorld(true) // node transforms (e.g. the hawk's x100 scale) must be applied before measuring
  model.traverse((o) => (o.frustumCulled = false)) // skinned/morphed bounds are unreliable
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  model.position.sub(box.getCenter(new THREE.Vector3()))
  const inner = new THREE.Group()
  inner.add(model)
  inner.scale.setScalar((2.4 * zoom) / Math.max(size.x, size.y, size.z))
  inner.rotation.y = yaw
  const group = new THREE.Group()
  group.add(inner)
  return group
}

/** Models that carry a flap clip (skeletal or morph targets): play it on a loop. */
function clipRig(gltf: Gltf, bird: BirdSpecies): BirdRig {
  const model = cloneSkinned(gltf.scene)
  const group = normalise(model, bird.yaw, bird.zoom)
  const mixer = new THREE.AnimationMixer(model)
  mixer.clipAction(gltf.animations[0]).play()
  return { group, update: (dt) => mixer.update(dt), dispose: () => mixer.stopAllAction() }
}

/**
 * Static flying-pose models (wings spread, no clip): bake the meshes into one space and flap the wings by
 * lifting each vertex in proportion to its distance from the body, so the tips beat and the root barely moves.
 */
function bendRig(gltf: Gltf, bird: BirdSpecies): BirdRig {
  gltf.scene.updateMatrixWorld(true)
  const root = new THREE.Group()
  gltf.scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return
    const m = o as THREE.Mesh
    const geo = m.geometry.clone()
    geo.applyMatrix4(m.matrixWorld)
    root.add(new THREE.Mesh(geo, m.material))
  })
  // centre the baked geometry on the origin so wing distance can be read straight from the coordinates
  const c = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3())
  root.children.forEach((m) => (m as THREE.Mesh).geometry.translate(-c.x, -c.y, -c.z))
  const group = normalise(root, bird.yaw, bird.zoom)
  const meshes = root.children as THREE.Mesh[]
  // read through getX/Y/Z: glb attributes can be interleaved, so the raw array is not one xyz triple per vertex
  const originals = meshes.map((m) => {
    const pos = m.geometry.getAttribute('position')
    const o = new Float32Array(pos.count * 3)
    for (let v = 0; v < pos.count; v++) o.set([pos.getX(v), pos.getY(v), pos.getZ(v)], v * 3)
    return o
  })

  // The wings run along whichever horizontal axis is longer; vertex y is the flap direction.
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3())
  const axis = size.x >= size.z ? 0 : 2
  const half = Math.max(size[axis === 0 ? 'x' : 'z'] / 2, 1e-6)
  const hz = bird.flapHz ?? 2
  const amp = half * 0.55 // tip travel, in model units
  let t = 0

  return {
    group,
    update: (dt) => {
      t += dt
      const s = Math.sin(t * hz * Math.PI * 2)
      meshes.forEach((m, i) => {
        const pos = m.geometry.getAttribute('position')
        const o = originals[i]
        for (let v = 0; v < pos.count; v++) {
          const a = o[v * 3 + axis]
          const d = Math.min(1, Math.abs(a) / half)
          const x = axis === 0 ? a * (1 - 0.12 * Math.abs(s) * d) : o[v * 3] // tips draw in a little at the top and bottom of the beat
          const z = axis === 2 ? a * (1 - 0.12 * Math.abs(s) * d) : o[v * 3 + 2]
          pos.setXYZ(v, x, o[v * 3 + 1] + s * amp * d * d, z)
        }
        pos.needsUpdate = true
        m.geometry.computeVertexNormals()
      })
    },
    dispose: () => meshes.forEach((m) => m.geometry.dispose()),
  }
}

export async function buildBird(bird: BirdSpecies): Promise<BirdRig> {
  const gltf = await load(bird.model)
  return bird.anim === 'clip' && gltf.animations.length ? clipRig(gltf, bird) : bendRig(gltf, bird)
}

let thumbGl: THREE.WebGLRenderer | null = null
const thumbs = new Map<string, Promise<string>>()

/** One still frame per bird from a single shared renderer, so a grid of birds costs one WebGL context. Resolves '' without WebGL. */
export function birdThumb(bird: BirdSpecies): Promise<string> {
  let p = thumbs.get(bird.id)
  if (!p) {
    p = (async () => {
      try {
        thumbGl ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
        const rig = await buildBird(bird)
        rig.update(0.2) // mid-beat pose instead of the bind pose
        const scene = new THREE.Scene()
        scene.add(new THREE.AmbientLight(0xffffff, 1.4))
        const sun = new THREE.DirectionalLight(0xfff2dd, 2.2)
        sun.position.set(2, 4, 3)
        scene.add(sun)
        rig.group.rotation.set(0.15, -0.6, 0)
        scene.add(rig.group)
        const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50)
        cam.position.set(0, 1.1, 4.2)
        cam.lookAt(0, 0, 0)
        thumbGl.setSize(256, 256, false)
        thumbGl.render(scene, cam)
        const url = thumbGl.domElement.toDataURL('image/png')
        rig.dispose()
        return url
      } catch {
        return ''
      }
    })()
    thumbs.set(bird.id, p)
  }
  return p
}
