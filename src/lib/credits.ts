/** Third-party attributions shown on the Credits screen. */
export type Credit = { name: string; author?: string; license: string; url?: string; models?: string[] }

const UNCONFIRMED = 'UNCONFIRMED — see README'

export const CREDITS: Credit[] = [
  { name: 'Hawk bird model', author: 'Sherkiz', license: 'CC BY', url: 'https://poly.pizza', models: ['hawk.glb'] },
  { name: 'Stork, Flamingo and Parrot bird models', author: 'mirada (from the three.js examples)', license: UNCONFIRMED, url: 'https://github.com/mrdoob/three.js', models: ['stork.glb', 'flamingo.glb', 'parrot.glb'] },
  { name: 'Gull, Seagull and Hummingbird bird models', author: 'Poly by Google', license: 'CC BY 3.0', url: 'https://poly.pizza', models: ['gull.glb', 'seagull.glb', 'hummingbird.glb'] },
  { name: 'OpenStreetMap', author: 'OpenStreetMap contributors', license: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright' },
  { name: 'OpenFreeMap', author: 'OpenFreeMap', license: 'Map tiles built on OpenStreetMap data (ODbL 1.0)', url: 'https://openfreemap.org' },
  { name: 'Natural Earth', author: 'Natural Earth', license: 'Public domain', url: 'https://www.naturalearthdata.com' },
  { name: 'GeoNames', author: 'GeoNames', license: 'CC BY 4.0', url: 'https://www.geonames.org' },
  { name: 'Wikipedia', author: 'Wikipedia contributors', license: 'CC BY-SA', url: 'https://www.wikipedia.org' },
  { name: 'GBIF', author: 'GBIF.org and data publishers', license: 'Per-dataset open licences (CC0, CC BY, CC BY-NC)', url: 'https://www.gbif.org' },
  { name: 'iNaturalist', author: 'iNaturalist observers', license: 'Per-observation licences chosen by observers', url: 'https://www.inaturalist.org' },
  { name: 'Open-Meteo', author: 'Open-Meteo.com', license: 'CC BY 4.0', url: 'https://open-meteo.com' },
  { name: 'flag-icons', author: 'Panayiotis Lipiridis', license: 'MIT', url: 'https://github.com/lipis/flag-icons' },
  { name: 'MapLibre GL JS', author: 'MapLibre contributors', license: 'BSD-3-Clause', url: 'https://maplibre.org' },
  { name: 'three.js', author: 'three.js authors', license: 'MIT', url: 'https://threejs.org' },
]
