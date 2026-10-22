import { useEffect, useRef, useState } from 'react'
import Flag from './Flag'
import { searchPlaces } from '../lib/places'
import type { Place } from '../lib/store'

type Props = {
  value: Place | null
  onChange: (p: Place | null) => void
  placeholder?: string
  large?: boolean
}

export default function PlaceSearch({ value, onChange, placeholder = 'Where to?', large = false }: Props) {
  const [text, setText] = useState(value ? `${value.name}, ${value.country}` : '')
  const [results, setResults] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [searched, setSearched] = useState(false)
  const timer = useRef<number>(0)

  useEffect(() => {
    if (value) setText(`${value.name}, ${value.country}`)
  }, [value])

  function onType(v: string) {
    setText(v)
    onChange(null)
    window.clearTimeout(timer.current)
    if (v.trim().length < 2) {
      setResults([])
      setSearched(false)
      return
    }
    timer.current = window.setTimeout(async () => {
      setResults(await searchPlaces(v))
      setSearched(true)
      setOpen(true)
    }, 150)
  }

  return (
    <div className="relative w-full">
      <img src="/assets/ic-search.svg" alt="" className="pointer-events-none absolute left-4 top-1/2 h-[17px] w-[17px] -translate-y-1/2" />
      <input
        value={text}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`w-full rounded-xl bg-white pl-10 pr-4 text-[16px] text-ink shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] outline-none placeholder:text-muted focus:ring-2 focus:ring-sage/40 ${large ? 'py-4' : 'py-2.5'}`}
      />
      {open && (results.length > 0 || searched) && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl bg-white py-1 shadow-[0_8px_24px_rgba(62,58,54,0.12)]">
          {results.length === 0 && <li className="px-4 py-3 text-[14px] text-muted">We couldn't find that place. Check the spelling.</li>}
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(p)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[15px] hover:bg-card-soft"
              >
                <Flag cc={p.cc} className="w-5" />
                <span className="text-ink">{p.name}</span>
                <span className="text-[13px] text-muted">{p.country}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
