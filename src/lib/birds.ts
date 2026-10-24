export type BirdSpecies = {
  id: string
  name: string
  trait: string
  tag: string
  model: string
  /** 'clip' = the glb carries a wing-flap animation; 'bend' = static flying pose, wings flapped procedurally */
  anim: 'clip' | 'bend'
  /** radians added so every model faces +Z (away from the flight camera) */
  yaw?: number
  /** size tweak where the glb's bounding box is larger than the visible bird */
  zoom?: number
  /** wing beats per second for 'bend' models */
  flapHz?: number
  credit: string
}

export const MODEL_CREDIT =
  'Birds: Hawk by Sherkiz (CC BY, Poly Pizza); Stork, Flamingo, Parrot by mirada (three.js examples); Gull, Seagull, Hummingbird by Poly by Google (CC BY 3.0, Poly Pizza)'

export const BIRDS: BirdSpecies[] = [
  { id: 'hawk', name: 'Hawk', trait: 'Sharp-eyed long-hauler', tag: 'Raptor', model: '/models/hawk.glb', anim: 'clip', yaw: Math.PI, credit: 'Hawk Lp Rigged by Sherkiz, CC BY, via Poly Pizza' },
  { id: 'stork', name: 'Stork', trait: 'The classic letter carrier', tag: 'Postal Class', model: '/models/stork.glb', anim: 'clip', zoom: 2.2, credit: 'Stork by mirada, from the three.js examples' },
  { id: 'flamingo', name: 'Flamingo', trait: 'Long, slow, graceful wingbeats', tag: 'Voyager', model: '/models/flamingo.glb', anim: 'clip', zoom: 3.5, credit: 'Flamingo by mirada, from the three.js examples' },
  { id: 'parrot', name: 'Parrot', trait: 'Chatty and colourful', tag: 'Showoff', model: '/models/parrot.glb', anim: 'clip', zoom: 2.5, credit: 'Parrot by mirada, from the three.js examples' },
  { id: 'gull', name: 'Gull', trait: 'Loves coasts & long skies', tag: 'Voyager', model: '/models/gull.glb', anim: 'bend', yaw: -Math.PI / 2, flapHz: 1.6, credit: 'Flying gull by Poly by Google, CC BY 3.0' },
  { id: 'seagull', name: 'Seagull', trait: 'Rides the sea wind', tag: 'Voyager', model: '/models/seagull.glb', anim: 'bend', yaw: -Math.PI / 2, flapHz: 1.6, credit: 'Flying seagull by Poly by Google, CC BY 3.0' },
  { id: 'hummingbird', name: 'Hummingbird', trait: 'Quick, tiny, tireless', tag: 'Acrobat', model: '/models/hummingbird.glb', anim: 'bend', flapHz: 6, credit: 'Hummingbird by Poly by Google, CC BY 3.0' },
]

const NAMES = ['Pip', 'Juniper', 'Wren', 'Biscuit', 'Olive', 'Clover', 'Maple', 'Sage', 'Poppy', 'Fig', 'Willow', 'Nimbus']

export const randomBirdName = () => NAMES[Math.floor(Math.random() * NAMES.length)]

/** Unknown or retired species (e.g. from an older save) fall back to the first bird. */
export const birdBySpecies = (species: string): BirdSpecies => BIRDS.find((b) => b.id === species) ?? BIRDS[0]
