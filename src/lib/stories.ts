import { api } from './api'
import { COGNITO_CONFIGURED } from './auth'
import { nearestCity } from './places'
import { send } from './outbox'
import { getState, setState, type Story } from './store'

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
type Inat = { results?: { taxon?: { preferred_common_name?: string; name?: string } }[] }

/** Optional Bedrock polish of the facts via POST /stories/compose; any failure (429, offline, signed out, slow) keeps the plain text. */
async function polish(placeId: string, lens: Lens, facts: string): Promise<string> {
  if (!COGNITO_CONFIGURED) return facts
  try {
    const slow = new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error('timeout')), 5000))
    const r = await Promise.race([api<{ text?: string }>('/stories/compose', { method: 'POST', body: JSON.stringify({ placeId, lens, facts }) }), slow])
    return r.text?.trim() || facts
  } catch {
    return facts
  }
}

/** Nearby places first, then the closest bundled city, then a plain fallback. Never throws. */
export async function buildStory(lat: number, lng: number, km: number): Promise<Omit<Story, 'id' | 'dateMs' | 'saved'>> {
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

  const inat = await getJson<Inat>(
    `https://api.inaturalist.org/v1/observations/species_counts?lat=${lat}&lng=${lng}&radius=60&iconic_taxa=Aves&per_page=3&locale=en`,
    3500,
  )
  let birds = (inat?.results ?? []).map((r) => r.taxon?.preferred_common_name || r.taxon?.name).filter((n): n is string => !!n)
  if (!birds.length) {
    const occ = await getJson<Occ>(
      `https://api.gbif.org/v1/occurrence/search?taxonKey=212&decimalLatitude=${lat - 0.4},${lat + 0.4}&decimalLongitude=${lng - 0.4},${lng + 0.4}&limit=40`,
      3000,
    )
    birds = [...new Set((occ?.results ?? []).map((o) => o.vernacularName || o.species).filter((n): n is string => !!n))].slice(0, 3)
  }

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
  void send({ id: `story-save:${id}`, method: 'PUT', path: `/stories/${id}`, body: { saved: !story.saved } })
}
