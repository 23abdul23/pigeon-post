import { api } from './api'
import { COGNITO_CONFIGURED } from './auth'
import { countryName } from './geo'
import { nearestCity } from './places'
import { send } from './outbox'
import { getState, setState, type Story } from './store'
import type { StoryExtras } from './types'

type Lens = Story['lens']

async function getJson<T>(url: string, ms = 4000): Promise<T | null> {
  const ctl = new AbortController()
  const t = window.setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    return r.ok ? ((await r.json()) as T) : null
  } catch {
    return null
  } finally {
    window.clearTimeout(t)
  }
}

function firstWords(text: string, max = 80): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  if (words.length <= max) return words.join(' ')
  const cut = words.slice(0, max).join(' ')
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '))
  return end > 120 ? cut.slice(0, end + 1) : `${cut.replace(/[,;:]$/, '')}…`
}

function pickLens(text: string): Lens {
  const t = text.toLowerCase()
  if (/(legend|myth|folklore|tale|saint)/.test(t)) return 'Legend'
  if (/(cuisine|dish|food|bread|tea|coffee|market|spice)/.test(t)) return 'Food'
  if (/(national park|river|lake|forest|mountain|bay|island|coast|wildlife|valley)/.test(t)) return 'Nature'
  if (/(century|war|empire|dynasty|founded|ancient|kingdom|built in)/.test(t)) return 'History'
  return 'Hidden spot'
}

type Page = { title: string; extract?: string; thumbnail?: { source: string }; index?: number; fullurl?: string; categories?: { title: string }[] }
type Near = { query?: { pages?: Record<string, Page> } }
type Occ = { results?: { vernacularName?: string; species?: string }[] }
type Taxon = { preferred_common_name?: string; name?: string; iconic_taxon_name?: string; default_photo?: { square_url?: string } }
type Inat = { results?: { taxon?: Taxon }[] }
type Country = { capital?: string[]; population?: number; languages?: Record<string, string>; currencies?: Record<string, { name?: string }>; demonyms?: { eng?: { m?: string } } }
type Summary = { extract?: string }

const INAT = 'https://api.inaturalist.org/v1/observations/species_counts'
const inatUrl = (lat: number, lng: number, taxa: string, n: number) => `${INAT}?lat=${lat}&lng=${lng}&radius=60&iconic_taxa=${taxa}&per_page=${n}&locale=en`
const KIND_BY_TAXON: Record<string, NonNullable<StoryExtras['wildlife']>[number]['kind']> = { Aves: 'Bird', Plantae: 'Plant', Mammalia: 'Mammal', Reptilia: 'Reptile', Amphibia: 'Amphibian', Insecta: 'Insect', Fungi: 'Fungus' }
// Wikipedia titles that need "the" (a 404 on Culture_of_X is retried with this form only for these)
const THE = new Set(['United States', 'United Kingdom', 'Netherlands', 'Philippines'])

const firstSentence = (t: string, max = 160) => {
  const s = t.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z])/)[0] ?? ''
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}\u2026` : s
}

function wildlifeOf(r: Inat | null, limit: number): NonNullable<StoryExtras['wildlife']> {
  return (r?.results ?? []).flatMap(({ taxon: t }) => {
    const name = t?.preferred_common_name || t?.name
    return name ? [{ name, kind: KIND_BY_TAXON[t?.iconic_taxon_name ?? ''] ?? ('Other' as const), photo: t?.default_photo?.square_url }] : []
  }).slice(0, limit)
}

async function cultureOf(cc: string): Promise<string | undefined> {
  const name = countryName(cc)
  const get = (n: string) => getJson<Summary>(`https://en.wikipedia.org/api/rest_v1/page/summary/Culture_of_${encodeURIComponent(n.replace(/ /g, '_'))}`)
  const r = (await get(name)) ?? (THE.has(name) ? await get(`the ${name}`) : null)
  const t = r?.extract ? firstWords(r.extract, 100) : ''
  return t.length > 600 ? `${t.slice(0, 599).replace(/\s+\S*$/, '')}\u2026` : t || undefined
}

async function peopleOf(cc: string): Promise<StoryExtras['people']> {
  const c = await getJson<Country>(`https://restcountries.com/v3.1/alpha/${encodeURIComponent(cc)}?fields=name,capital,population,languages,currencies,demonyms`)
  if (!c) return undefined
  const p = {
    capital: c.capital?.[0],
    population: c.population,
    languages: c.languages ? Object.values(c.languages).slice(0, 6) : undefined,
    currency: Object.values(c.currencies ?? {})[0]?.name,
    demonym: c.demonyms?.eng?.m,
  }
  return Object.values(p).some((v) => v !== undefined) ? p : undefined
}

/** Optional Bedrock polish of the facts via POST /stories/compose; any failure (429, offline, signed out, slow) keeps the plain text. */
async function polish(placeId: string, lens: Lens, facts: string): Promise<string> {
  if (!COGNITO_CONFIGURED) return facts
  let t = 0
  let timer: Promise<never>
  try {
    timer = new Promise<never>((_, rej) => (t = window.setTimeout(() => rej(new Error('timeout')), 5000)))
    const r = await Promise.race([api<{ text?: string }>('/stories/compose', { method: 'POST', body: JSON.stringify({ placeId, lens, facts }) }), timer])
    return r.text?.trim() || facts
  } catch {
    return facts
  } finally {
    window.clearTimeout(t)
  }
}

type Built = Omit<Story, 'id' | 'dateMs' | 'saved'>

const cache = new Map<string, Promise<Built>>() // oldest first
const MAX_CACHED = 8

function cached(lat: number, lng: number, km: number): Promise<Built> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`
  let p = cache.get(key)
  if (!p) {
    const mine = (p = compute(lat, lng, km))
    cache.set(key, mine)
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!)
    // only a story from the network is worth keeping; the plain fallback is retried next time
    const drop = () => cache.get(key) === mine && cache.delete(key)
    mine.then((s) => (s.photo || s.sourceUrl ? undefined : drop()), drop)
  }
  return p
}

/** Starts building the story for a place ahead so `buildStory` there finds it ready. */
export function prefetchStory(lat: number, lng: number, km: number): void {
  cached(lat, lng, km).then((s) => {
    if (typeof Image === 'undefined') return
    const x = s.extras
    for (const u of [s.photo, ...(x?.nearby ?? []).map((n) => n.photo), ...(x?.wildlife ?? []).map((w) => w.photo)]) if (u) new Image().src = u
  }, () => undefined)
}

/** Nearby places first, then the closest bundled city, then a plain fallback. Cached per place (see `prefetchStory`). Never throws. */
export async function buildStory(lat: number, lng: number, km: number): Promise<Built> {
  return { ...(await cached(lat, lng, km)), km }
}

async function compute(lat: number, lng: number, km: number): Promise<Built> {
  const city = await nearestCity(lat, lng)

  // One call: the 12 nearest articles with intro text, thumbnail and categories (the categories pick the lens).
  const near = await getJson<Near>(
    `https://en.wikipedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat}%7C${lng}&ggsradius=10000&ggslimit=12&prop=extracts%7Cpageimages%7Ccategories%7Cinfo&exintro=1&explaintext=1&exchars=900&piprop=thumbnail&pithumbsize=900&cllimit=20&inprop=url&format=json&origin=*`,
  )
  const pages = Object.values(near?.query?.pages ?? {})
    .filter((p) => (p.extract?.length ?? 0) > 120)
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
  const pick = pages.find((p) => p.thumbnail) ?? pages[0] // prefer a place that has a picture, nearest first

  const text = pick?.extract
    ? firstWords(pick.extract)
    : `Your bird rested above ${city.name}, ${city.country}. A quiet stop on a long journey, with the whole sky still ahead.`

  // everything below runs in parallel: total time is the slowest call, not the sum
  const [inat, plants, animals, people, culture] = await Promise.all([
    getJson<Inat>(inatUrl(lat, lng, 'Aves', 3), 3500),
    getJson<Inat>(inatUrl(lat, lng, 'Plantae', 3), 3500),
    getJson<Inat>(inatUrl(lat, lng, 'Mammalia,Reptilia,Amphibia,Insecta', 3), 3500),
    peopleOf(city.cc),
    cultureOf(city.cc),
  ])
  let birds = (inat?.results ?? []).map((r) => r.taxon?.preferred_common_name || r.taxon?.name).filter((n): n is string => !!n)
  if (!birds.length) {
    const occ = await getJson<Occ>(
      `https://api.gbif.org/v1/occurrence/search?taxonKey=212&decimalLatitude=${lat - 0.4},${lat + 0.4}&decimalLongitude=${lng - 0.4},${lng + 0.4}&limit=40`,
      3000,
    )
    birds = [...new Set((occ?.results ?? []).map((o) => o.vernacularName || o.species).filter((n): n is string => !!n))].slice(0, 3)
  }

  const nearby = pages
    .filter((p) => p !== pick)
    .slice(0, 5)
    .map((p) => ({ title: p.title, blurb: p.extract ? firstSentence(p.extract) : undefined, photo: p.thumbnail?.source, url: p.fullurl }))
  const seen = new Set<string>()
  const wildlife = [...wildlifeOf(inat, 3), ...wildlifeOf(plants, 3), ...wildlifeOf(animals, 3)]
    .filter((w) => !seen.has(w.name.toLowerCase()) && !!seen.add(w.name.toLowerCase()))
    .slice(0, 8)
  const hasExtras = !!(nearby.length || wildlife.length || people || culture)

  const cats = (pick?.categories ?? []).map((c) => c.title).join(' ')
  const lens = pickLens(`${cats} ${text}`)
  const place = pick?.title ?? city.name
  const polished = pick?.extract ? await polish(place.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'place', lens, text) : text
  return {
    place,
    region: city.name === (pick?.title ?? city.name) ? undefined : city.name,
    country: city.country,
    cc: city.cc,
    lens,
    text: polished,
    photo: pick?.thumbnail?.source,
    sourceUrl: pick?.fullurl,
    birds,
    extras: hasExtras ? { nearby: nearby.length ? nearby : undefined, wildlife: wildlife.length ? wildlife : undefined, people, culture } : undefined,
    km,
    lat,
    lng,
  }
}

/** Toggles a story's keepsake flag locally and on the server (`PUT /stories/{id}`). */
export function toggleStorySaved(id: string): void {
  const story = getState().stories.find((s) => s.id === id)
  if (!story) return
  setState({ stories: getState().stories.map((s) => (s.id === id ? { ...s, saved: !s.saved } : s)) })
  void send({ id: `story-save:${id}`, method: 'PUT', path: `/stories/${id}`, body: { saved: !story.saved }, touches: [`story:${id}`] })
}
