import { useEffect, useState } from 'react'

type Search = { query?: { pages?: Record<string, { index?: number; thumbnail?: { source?: string } }> } }

const cache = new Map<string, Promise<string | null>>()

export const wikiPhotoUrl = (place: string, country: string) =>
  `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`${place}, ${country}`)}&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=900&format=json&origin=*`

/** The picture of the first Wikipedia search result for "{place}, {country}", or null (no result, no picture, offline). Cached per place. */
export function wikiPhoto(place: string, country: string): Promise<string | null> {
  const key = `${place}, ${country}`.toLowerCase()
  let hit = cache.get(key)
  if (!hit) {
    hit = (async () => {
      try {
        const r = await fetch(wikiPhotoUrl(place, country))
        if (!r.ok) return null
        const pages = Object.values(((await r.json()) as Search).query?.pages ?? {})
        const first = pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99))[0]
        return first?.thumbnail?.source ?? null
      } catch {
        return null
      }
    })()
    hit.then((v) => v ?? cache.delete(key)) // a miss may be a network blip: retry next time
    cache.set(key, hit)
  }
  return hit
}

/** The story's picture from Wikipedia's first result for "{place}, {country}"; the stored photo shows until it arrives or when there is none. */
export function useWikiPhoto(story: { place: string; country: string; photo?: string }): string | undefined {
  const [found, setFound] = useState<{ key: string; url: string } | null>(null)
  const key = `${story.place}, ${story.country}`
  useEffect(() => {
    if (!story.place) return
    let live = true
    void wikiPhoto(story.place, story.country).then((url) => live && url && setFound({ key, url }))
    return () => {
      live = false
    }
  }, [key, story.place, story.country])
  return found?.key === key ? found.url : story.photo
}
