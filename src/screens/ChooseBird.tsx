import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import BirdThumb from '../components/BirdThumb'
import BirdViewer from '../components/BirdViewer'
import Header from '../components/Header'
import { Frame } from '../components/Layout'
import { BIRDS, MODEL_CREDIT, randomBirdName } from '../lib/birds'
import { getState, setState } from '../lib/store'
import { saveProfile } from '../lib/sync'

export default function ChooseBird() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const fromSettings = params.get('from') === 'settings'
  const current = getState().bird
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(current?.species ?? BIRDS[0].id)
  const [name, setName] = useState(current?.name ?? 'Pip')

  const q = query.trim().toLowerCase()
  const list = useMemo(() => (q ? BIRDS.filter((b) => b.name.toLowerCase().includes(q)) : BIRDS), [q])
  const selected = BIRDS.find((b) => b.id === selectedId) ?? BIRDS[0]

  function start() {
    setState({ bird: { species: selected.id, name: name.trim() || 'Pip' } })
    saveProfile()
    nav(fromSettings ? '/settings/birds' : '/home', { replace: true })
  }

  const back = fromSettings ? '/settings/birds' : '/onboarding/city'

  return (
    <Frame>
      <Header title="Choose Your Bird" />
      <main className="lg:max-w-[1100px] flex-1 px-4 pb-4 pt-1">
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="size-2 rounded-full bg-line" />
            <span className="size-2 rounded-full bg-line" />
            <span className="h-2 w-6 rounded-full bg-sage" />
          </div>
          <span className="text-[12px] font-semibold uppercase tracking-[0.6px] text-sky-ink">Step 3 of 3</span>
        </div>

        <div className="pt-2">
          <h1 className="font-serif text-[32px] leading-10 text-ink">Choose your bird</h1>
          <div className="flex h-7 items-center gap-1.5 whitespace-nowrap">
            <span className="text-[16px] text-ink-2">You can change it any time.</span>
            <span className="-rotate-2 font-hand text-[19px] font-medium text-[#8e4d31]">Every soul has wings!</span>
          </div>
        </div>

        <div className="pt-5">
          <div className="relative">
            <img src="/assets/ic-search-bird.svg" alt="" className="pointer-events-none absolute left-3.5 top-[13px] size-[15px]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a bird name..."
              aria-label="Search birds"
              className="w-full rounded-xl bg-card-soft py-2.5 pl-10 pr-4 text-[14px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] outline-none placeholder:text-muted focus:ring-2 focus:ring-sage/40"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5 pt-5">
          {list.map((b, i) => {
            const on = b.id === selectedId
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedId(b.id)}
                aria-pressed={on}
                className={`relative flex flex-col rounded-2xl p-3 text-left ${on ? 'bg-card shadow-[0_0_0_2px_#446650,0_1px_2px_rgba(0,0,0,0.05)]' : 'bg-card-soft'}`}
              >
                <div className={`relative aspect-square overflow-hidden rounded-xl ${i % 2 ? 'bg-card' : 'bg-card-soft'}`}>
                  <BirdThumb bird={b} className="absolute inset-0 size-full object-contain" />
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-sky-ink">{b.tag}</span>
                </div>
                <span className="pt-2.5 font-serif text-[20px] font-semibold leading-[25px] text-ink">{b.name}</span>
                <span className="pt-0.5 text-[14px] leading-5 text-ink-2">{b.trait}</span>
                {on && (
                  <span className="absolute right-2.5 top-2.5 flex size-5 items-center justify-center rounded-full bg-sage">
                    <img src="/assets/ic-check-white.svg" alt="Selected" className="h-[7px] w-[9.5px]" />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {list.length === 0 && <p className="mt-3 rounded-2xl bg-card-soft p-4 text-center text-[14px] text-ink-2">No bird by that name yet.</p>}

        <section className="mt-5 overflow-hidden rounded-2xl bg-card-soft p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <img src="/assets/ic-focus-frame.svg" alt="" className="size-[16.7px]" />
              <h2 className="pl-2 font-serif text-[20px] font-semibold leading-7 text-ink">
                {selected.name}
              </h2>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-[12px] font-semibold tracking-[0.36px] text-sky-ink">
              <img src="/assets/ic-drag.svg" alt="" className="h-[12.8px] w-[11.5px]" />
              Drag to rotate
            </span>
          </div>
          <div className="relative mt-3 h-44 overflow-hidden rounded-xl bg-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]">
            <img src="/assets/rotate-dial.svg" alt="" className="pointer-events-none absolute inset-0 size-full" />
            <BirdViewer bird={selected} className="absolute inset-0" />
            <span className="pointer-events-none absolute inset-x-0 bottom-1.5 -rotate-1 text-center font-hand text-[22px] font-medium text-[#8e4d31] opacity-90">360° courier view</span>
          </div>
          <div className="pt-3">
            <div className="flex items-center justify-between">
              <label htmlFor="bird-name" className="text-[14px] font-bold tracking-[0.28px] text-ink-2">
                Name your bird
              </label>
              <span className="text-[12px] font-semibold tracking-[0.36px] text-[#8e4d31]">Letters will be stamped here</span>
            </div>
            <div className="relative mt-1.5">
              <img src="/assets/ic-pencil.svg" alt="" className="pointer-events-none absolute left-3.5 top-[13px] size-[13.5px]" />
              <input
                id="bird-name"
                value={name}
                maxLength={20}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl bg-white px-10 py-2.5 text-[16px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] outline-none focus:ring-2 focus:ring-sage/40"
              />
              <button
                type="button"
                aria-label="Suggest a random name"
                onClick={() => setName(randomBirdName())}
                className="absolute right-2 top-[3px] flex size-8 items-center justify-center rounded-lg"
              >
                <img src="/assets/ic-dice.svg" alt="" className="size-[15px]" />
              </button>
            </div>
          </div>
        </section>

        <p className="pt-4 text-center text-[11px] text-muted">{MODEL_CREDIT}</p>

        <div className="flex items-center gap-3 pt-4">
          <Link to={back} className="flex items-center gap-1 rounded-full px-5 py-3 text-[14px] font-bold tracking-[0.28px] text-sky-ink">
            <img src="/assets/ic-back.svg" alt="" className="size-3" />
            Back
          </Link>
          <button
            type="button"
            onClick={start}
            className="flex items-center justify-center gap-2 rounded-full bg-[#d58767] px-6 py-3 text-[14px] font-bold tracking-[0.35px] text-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]"
          >
            <img src="/assets/ic-plane-white.svg" alt="" className="h-[18.3px] w-[14.8px]" />
            {fromSettings ? 'Save bird' : 'Start flying'}
          </button>
        </div>
      </main>
    </Frame>
  )
}
