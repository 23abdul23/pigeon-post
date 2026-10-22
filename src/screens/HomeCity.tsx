import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Frame } from '../components/Layout'
import Header from '../components/Header'
import MiniMap from '../components/MiniMap'
import Flag from '../components/Flag'
import { searchPlaces, toCity } from '../lib/places'
import { getState, setState, type Place } from '../lib/store'

const fmtCoord = (lat: number, lng: number) =>
  `${Math.abs(Math.round(lat * 10000) / 10000).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(Math.round(lng * 10000) / 10000).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`

export default function HomeCity() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const fromSettings = params.get('from') === 'settings'
  const existing = getState().homeCity
  const [text, setText] = useState(existing ? existing.name : '')
  const [results, setResults] = useState<Place[]>([])
  const [selected, setSelected] = useState<Place | null>(
    existing ? { id: 'current', name: existing.name, country: existing.country, cc: existing.cc, lat: existing.lat, lng: existing.lng } : null,
  )
  const [searched, setSearched] = useState(false)
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function onType(v: string) {
    setText(v)
    setSelected(null)
    window.clearTimeout(timer.current)
    if (v.trim().length < 2) {
      setResults([])
      setSearched(false)
      return
    }
    timer.current = window.setTimeout(async () => {
      setResults(await searchPlaces(v, 5))
      setSearched(true)
    }, 150)
  }

  function pick(p: Place) {
    setSelected(p)
    setText(`${p.name}, ${p.country}`)
  }

  function clear() {
    setText('')
    setSelected(null)
    setResults([])
    setSearched(false)
  }

  function next() {
    if (!selected) return
    setState({ homeCity: toCity(selected) })
    nav(fromSettings ? '/settings/city' : '/onboarding/bird')
  }

  const showList = !selected && (results.length > 0 || searched)
  const shown = selected ? [selected] : results
  const back = fromSettings ? '/settings/city' : '/signin'

  return (
    <Frame>
      <Header title="Home City" />
      <main className="flex-1 px-4 pb-8 pt-1">
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-1" aria-hidden>
            <span className="size-2.5 rounded-full bg-[rgba(127,163,138,0.4)]" />
            <span className="h-2.5 w-6 rounded-full bg-sage" />
            <span className="size-2.5 rounded-full bg-line" />
          </div>
          <span className="text-[12px] font-semibold uppercase tracking-[0.6px] text-sky-ink">Step 2 of 3</span>
        </div>

        <div className="pt-5">
          <div className="relative flex items-center justify-between">
            <h1 className="font-serif text-[32px] leading-10 tracking-[-0.8px] text-ink">Where is home?</h1>
            <span className="-rotate-6 font-hand text-[22px] font-medium text-[#8e4d31]">home roost!</span>
          </div>
          <p className="pt-1 text-[16px] leading-[26px] text-ink-2">Your bird starts and returns here. City level only.</p>
        </div>

        <div className="relative z-10 pt-5">
          <div className="flex items-center rounded-2xl bg-white px-4 py-3.5 drop-shadow-[0_2px_6px_rgba(62,58,54,0.06)]">
            <span className="mr-3 flex size-9 shrink-0 items-center justify-center rounded-full bg-[#c6ecd0]">
              <img src="/assets/ic-pin-big.svg" alt="" className="h-[16.7px] w-[13.3px]" />
            </span>
            {selected && <Flag cc={selected.cc} className="mr-2 w-5" />}
            <input
              value={text}
              onChange={(e) => onType(e.target.value)}
              placeholder="Type your city"
              aria-label="Home city"
              className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-muted"
            />
            {text && (
              <button type="button" onClick={clear} aria-label="Clear city" className="flex size-7 items-center justify-center rounded-full">
                <img src="/assets/ic-clear.svg" alt="" className="size-[15px]" />
              </button>
            )}
          </div>

          {(showList || selected) && (
            <div className="mt-2 flex flex-col gap-1 rounded-2xl bg-white p-2 shadow-[0_8px_24px_-4px_rgba(62,58,54,0.12)]">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.6px] text-sky-ink">Matching postal stations</span>
                <span className="text-[12px] font-bold tracking-[0.36px] text-sage">
                  {shown.length} place{shown.length === 1 ? '' : 's'} found
                </span>
              </div>
              {shown.length === 0 && <p className="px-3 pb-3 text-[14px] text-ink-2">We couldn't find that city. Check the spelling.</p>}
              {shown.map((p) => {
                const on = selected?.id === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick(p)}
                    className={`flex items-center justify-between rounded-xl p-3 text-left ${on ? 'bg-[rgba(198,236,208,0.4)]' : ''}`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Flag cc={p.cc} className="w-6" />
                      <span className="min-w-0">
                        <span className={`block text-[16px] leading-6 text-ink ${on ? 'font-bold' : 'font-semibold'}`}>{p.name}</span>
                        <span className="block truncate text-[14px] leading-5 text-ink-2">
                          {p.country} • Coordinates {Math.abs(p.lat).toFixed(4)}° {p.lat >= 0 ? 'N' : 'S'}
                        </span>
                      </span>
                    </span>
                    {on ? <img src="/assets/ic-check.svg" alt="Selected" className="size-[16.7px]" /> : <img src="/assets/ic-chevron-small.svg" alt="" className="size-[11px]" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="pt-5">
          <div className="relative flex flex-col gap-3 overflow-hidden rounded-[20px] bg-card p-4 shadow-[0_2px_8px_-2px_rgba(62,58,54,0.05)]">
            <div className="pointer-events-none absolute -right-8 -top-8 flex size-[132px] rotate-12 items-center justify-center" aria-hidden>
              <div className="flex size-28 items-center justify-center rounded-full border-2 border-dashed border-outline/40 text-center font-hand text-[12px] uppercase leading-4 tracking-[1.2px] text-ink-2/40">
                Air mail •<br />
                Departure
              </div>
            </div>
            <MiniMap
              center={selected ?? { lat: 20, lng: 0 }}
              zoom={selected ? 10 : 1.2}
              className="flex h-44 items-center justify-center rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]"
            >
              <img src="/assets/map-overlay.svg" alt="" className="pointer-events-none absolute inset-0 size-full opacity-60" />
              {selected && (
                <>
                  <span className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-md bg-white/90 px-2.5 py-1 text-[12px] font-medium tracking-[0.36px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[2px]">
                    <img src="/assets/ic-coords.svg" alt="" className="size-[11.7px]" />
                    {fmtCoord(selected.lat, selected.lng)}
                  </span>
                  <div className="relative flex flex-col items-center">
                    <span className="mb-1 flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[12px] font-bold tracking-[0.36px] text-ink shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)]">
                      <img src="/assets/ic-pin-small.svg" alt="" className="h-[13.8px] w-[7.5px]" />
                      The Roost
                    </span>
                    <span className="flex size-8 items-center justify-center rounded-full bg-sage shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)]">
                      <img src="/assets/ic-plane-center.svg" alt="" className="size-[15px]" />
                    </span>
                    <span className="mt-0.5 size-2 rounded-full bg-ink/30 blur-[0.5px]" />
                  </div>
                </>
              )}
            </MiniMap>
            <div className="flex items-center gap-2.5 rounded-full bg-card-soft px-3 py-2 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <img src="/assets/ic-shield.svg" alt="" className="h-[15px] w-3 shrink-0" />
              <span className="text-[14px] font-medium leading-[17.5px] text-ink">Only your city is stored &amp; visible to correspondents.</span>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-xl bg-[rgba(255,219,205,0.3)] p-3.5">
          <img src="/assets/ic-mail-note.svg" alt="" className="mt-0.5 h-[15.3px] w-[16.7px]" />
          <div>
            <p className="font-serif text-[15px] font-semibold leading-[20.6px] text-[#360f00]">Why set a home base?</p>
            <p className="text-[14px] leading-[17.5px] text-ink-2">Letters take realistic bird flight hours to journey between cities. Safe roosts make safe journeys.</p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-8">
          <Link to={back} className="flex h-12 items-center gap-1.5 rounded-full px-5 text-[14px] font-bold tracking-[0.28px] text-sky-ink">
            <img src="/assets/ic-back.svg" alt="" className="size-3" />
            Back
          </Link>
          <button
            type="button"
            onClick={next}
            disabled={!selected}
            className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#8e4d31] px-8 text-[14px] font-bold tracking-[0.28px] text-white drop-shadow-[0_4px_7px_rgba(142,77,49,0.25)] disabled:opacity-40"
          >
            {fromSettings ? 'Save' : 'Continue'}
            <img src="/assets/ic-continue.svg" alt="" className="size-3" />
          </button>
        </div>
      </main>
    </Frame>
  )
}
