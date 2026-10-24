import type { StoryExtras } from '../lib/types'

type Section = 'nearby' | 'wildlife' | 'people'

const nf = new Intl.NumberFormat('en-US')

/** Which parts of `extras` have something to show (drives both the sections here and the StopCard tabs). */
export const extrasHas = (x?: StoryExtras) => ({
  nearby: !!x?.nearby?.length,
  wildlife: !!x?.wildlife?.length,
  people: !!x?.people || !!x?.culture,
})

const hide = (e: React.SyntheticEvent<HTMLImageElement>) => void (e.currentTarget.style.display = 'none')

function Heading({ children }: { children: string }) {
  return <h3 className="text-[12px] font-bold uppercase tracking-[0.6px] text-sky-ink">{children}</h3>
}

function Nearby({ items }: { items: NonNullable<StoryExtras['nearby']> }) {
  return (
    <section className="flex flex-col gap-2">
      <Heading>Nearby</Heading>
      <ul className="flex flex-col gap-2">
        {items.map((n) => {
          const body = (
            <>
              {n.photo && <img src={n.photo} alt={n.title} loading="lazy" referrerPolicy="no-referrer" onError={hide} className="size-16 shrink-0 rounded-lg bg-card-soft object-cover" />}
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-ink">{n.title}</span>
                {n.blurb && <span className="line-clamp-2 text-[13px] leading-[18px] text-ink-2">{n.blurb}</span>}
              </span>
            </>
          )
          return (
            <li key={n.title} className="rounded-xl bg-card drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              {n.url ? (
                <a href={n.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-2">
                  {body}
                </a>
              ) : (
                <div className="flex items-center gap-3 p-2">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Wildlife({ items }: { items: NonNullable<StoryExtras['wildlife']> }) {
  return (
    <section className="flex flex-col gap-2">
      <Heading>Wildlife</Heading>
      <ul className="flex flex-wrap gap-2">
        {items.map((w) => (
          <li key={w.name} className="flex max-w-full items-center gap-2 rounded-full bg-card py-1 pl-1 pr-3">
            {w.photo ? (
              <img src={w.photo} alt={w.name} loading="lazy" referrerPolicy="no-referrer" onError={hide} className="size-8 shrink-0 rounded-full bg-card-soft object-cover" />
            ) : (
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky text-[13px] font-bold text-ink">
                {w.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="min-w-0 leading-4">
              <span className="block truncate text-[13px] font-semibold capitalize text-ink">{w.name}</span>
              <span className="block text-[11px] text-sage">{w.kind}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function People({ people, culture }: Pick<StoryExtras, 'people' | 'culture'>) {
  const p = people
  const chips = (
    [
      ['Capital', p?.capital],
      ['Population', p?.population === undefined ? undefined : nf.format(p.population)],
      ['Languages', p?.languages?.join(', ')],
      ['Currency', p?.currency],
      ['People', p?.demonym],
    ] as [string, string | undefined][]
  ).filter((c): c is [string, string] => !!c[1])
  return (
    <section className="flex flex-col gap-2">
      <Heading>People &amp; culture</Heading>
      {chips.length > 0 && (
        <dl className="flex flex-wrap gap-2">
          {chips.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-card px-3 py-1.5">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">{k}</dt>
              <dd className="text-[13px] font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {culture && <p className="text-[14px] leading-5 text-ink-2">{culture}</p>}
    </section>
  )
}

/** The extra story sections; `only` shows one (a StopCard tab), otherwise every section that has data. */
export default function StoryDetails({ extras, only }: { extras?: StoryExtras; only?: Section }) {
  const has = extrasHas(extras)
  if (!extras || !(has.nearby || has.wildlife || has.people)) return null
  const show = (s: Section) => has[s] && (!only || only === s)
  return (
    <div className="flex flex-col gap-5">
      {show('nearby') && <Nearby items={extras.nearby!} />}
      {show('wildlife') && <Wildlife items={extras.wildlife!} />}
      {show('people') && <People people={extras.people} culture={extras.culture} />}
    </div>
  )
}
