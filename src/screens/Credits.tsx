import { useNavigate } from 'react-router-dom'
import { Frame } from '../components/Layout'
import { CREDITS } from '../lib/credits'
import { S } from '../lib/strings'

export default function Credits() {
  const nav = useNavigate()
  return (
    <Frame nav>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-2 bg-cream/85 px-4 backdrop-blur-[12px]">
        <button type="button" onClick={() => nav(-1)} className="text-[14px] font-bold text-sage">{S.creditsBack}</button>
        <h1 className="text-[18px] font-bold text-ink">{S.creditsTitle}</h1>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 pb-24">
        <p className="pb-3 text-[13px] leading-5 text-ink-2">{S.creditsIntro}</p>
        <ul className="flex flex-col gap-2">
          {CREDITS.map((c) => (
            <li key={c.name} className="rounded-xl bg-white p-3 text-[13px] leading-5 text-ink-2 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <p className="font-bold text-ink">{c.name}</p>
              {c.author && <p>{S.creditsBy} {c.author}</p>}
              <p>{S.creditsLicense}: {c.license}</p>
              {c.models && <p>{S.creditsModels}: {c.models.join(', ')}</p>}
              {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="break-all text-sage">{c.url}</a>}
            </li>
          ))}
        </ul>
      </main>
    </Frame>
  )
}
