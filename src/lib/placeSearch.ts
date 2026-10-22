import { searchPlaces, type PlaceKind, type PlaceResults, type PlaceSource } from './places'

/** Home stays city level for privacy: the home screen never asks for landmarks or streets. */
export const HOME_SEARCH_KIND = 'city' satisfies PlaceKind

/** OpenStreetMap-derived results must carry attribution; bundled GeoNames results get the "Offline results" note instead. */
export const attributionFor = (source: PlaceSource) => (source === 'server' ? '© OpenStreetMap contributors' : null)

/**
 * Typeahead controller: debounces keystrokes, aborts the previous request on each one, and drops any response that is
 * not for the latest query (so a slow older response never overwrites newer results). `onResult(null)` means cleared
 * (under 2 characters, no request).
 */
export function createPlaceSearch({
  kind,
  onResult,
  search = searchPlaces,
  debounceMs = 250,
}: {
  kind: PlaceKind
  onResult: (r: PlaceResults | null) => void
  search?: typeof searchPlaces
  debounceMs?: number
}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let ctrl: AbortController | undefined
  let seq = 0
  const cancel = () => {
    clearTimeout(timer)
    ctrl?.abort()
    return ++seq
  }
  return {
    query(text: string) {
      const mine = cancel()
      if (text.trim().length < 2) return onResult(null)
      timer = setTimeout(() => {
        const c = (ctrl = new AbortController())
        search(text, { kind, signal: c.signal }).then(
          (r) => mine === seq && onResult(r),
          () => {}, // aborted: a newer query owns the list
        )
      }, debounceMs)
    },
    cancel() {
      cancel()
    },
  }
}
