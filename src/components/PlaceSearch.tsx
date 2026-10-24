import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import Flag from './Flag'
import { placeLabel, type PlaceKind, type PlaceSource } from '../lib/places'
import { attributionFor, createPlaceSearch } from '../lib/placeSearch'
import type { Place } from '../lib/store'

type Props = {
  value: Place | null
  onChange: (p: Place | null) => void
  /** 'city' for home (city level only), 'any' for destinations (also landmarks and regions) */
  kind: PlaceKind
  placeholder?: string
  large?: boolean
  /** 'parent' lets the results list span the nearest positioned ancestor (e.g. a full-width row) instead of only this field. */
  listAnchor?: 'field' | 'parent'
}

export const placeDetail = (p: Place) => (p.region ? `${p.region}, ${p.country}` : p.country)

/** "Offline results" when the server could not be used, the provider's attribution when it was. */
export function PlaceSourceNote({ source }: { source: PlaceSource }) {
  const attribution = attributionFor(source)
  return <p className="px-4 pb-1 pt-1.5 text-[11px] text-muted">{attribution ?? 'Offline results'}</p>
}

export default function PlaceSearch({ value, onChange, kind, placeholder = 'Where to?', large = false, listAnchor = 'field' }: Props) {
  const [text, setText] = useState(value ? placeLabel(value) : '')
  const [results, setResults] = useState<Place[]>([])
  const [source, setSource] = useState<PlaceSource>('photon')
  const [open, setOpen] = useState(false)
  const [searched, setSearched] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const searcher = useRef<ReturnType<typeof createPlaceSearch>>(null)
  searcher.current ??= createPlaceSearch({
    kind,
    onResult: (r) => {
      setResults(r?.places ?? [])
      setSearched(!!r)
      setActive(-1)
      if (r) {
        setSource(r.source)
        setOpen(true)
      }
    },
  })

  useEffect(() => () => searcher.current?.cancel(), [])
  useEffect(() => {
    if (value) setText(placeLabel(value))
  }, [value])

  function onType(v: string) {
    setText(v)
    onChange(null)
    searcher.current!.query(v)
  }

  function choose(p: Place) {
    searcher.current!.cancel() // a still-pending search must not reopen the list over the choice
    onChange(p)
    setOpen(false)
  }

  const expanded = open && (results.length > 0 || searched)

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') return setOpen(false)
    if (!results.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + results.length) % results.length)
    } else if (e.key === 'Enter' && expanded && active >= 0) {
      e.preventDefault()
      choose(results[active])
    }
  }

  return (
    <div className={`${listAnchor === 'field' ? 'relative ' : ''}w-full`}>
      <div className="relative">
      <img src="/assets/ic-search.svg" alt="" className="pointer-events-none absolute left-4 top-1/2 h-[17px] w-[17px] -translate-y-1/2" />
      <input
        value={text}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => {
          searcher.current!.cancel() // a search still pending must not reopen the list after leaving the field
          window.setTimeout(() => setOpen(false), 120)
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        className={`w-full rounded-xl bg-white pl-10 pr-4 text-[16px] text-ink shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] outline-none placeholder:text-muted focus:ring-2 focus:ring-sage/40 ${large ? 'py-4' : 'py-2.5'}`}
      />
      </div>
      {expanded && (
        <div
          className={`absolute z-20 mt-1 overflow-hidden rounded-xl bg-white py-1 shadow-[0_8px_24px_rgba(62,58,54,0.12)] ${
            listAnchor === 'parent' ? 'left-0 right-0 top-full' : 'w-full'
          }`}
        >
          {results.length === 0 && <p className="px-4 py-3 text-[14px] text-muted">We couldn't find that place. Check the spelling.</p>}
          <ul id={listId} role="listbox" aria-label="Places" className="max-h-64 overflow-auto">
            {results.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(p)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left text-[15px] ${i === active ? 'bg-card-soft' : ''}`}
              >
                <Flag cc={p.cc} className="w-5 shrink-0" />
                <span className="shrink-0 text-ink">{p.name}</span>
                <span className="truncate text-[13px] text-muted">{placeDetail(p)}</span>
              </li>
            ))}
          </ul>
          <PlaceSourceNote source={source} />
        </div>
      )}
    </div>
  )
}
