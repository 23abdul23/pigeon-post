import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Frame } from '../components/Layout'
import { playRustle } from '../lib/sound'
import { countryName, haversineKm } from '../lib/geo'
import { send } from '../lib/outbox'
import { attachmentUrl } from '../lib/social'
import { getState, setState, useStore, type Letter } from '../lib/store'

type Attachment = Letter['attachments'][number]

/** Image source for an attachment: its local preview, else a short-lived presigned URL (fetched once per mount). */
function useAttachmentUrl(a: Attachment): string | undefined {
  const [url, setUrl] = useState(a.dataUrl)
  useEffect(() => {
    let live = true
    if (!a.dataUrl) attachmentUrl(a).then((u) => live && setUrl(u), () => {})
    return () => {
      live = false
    }
  }, [a.dataUrl, a.key]) // eslint-disable-line react-hooks/exhaustive-deps -- the 30 s poll hands us new objects for the same file
  return url
}

function AttachedImage({ a }: { a: Attachment }) {
  return <img src={useAttachmentUrl(a)} alt={a.name} className="h-48 w-full bg-card object-cover" />
}

export default function OpenedLetter() {
  const { letterId } = useParams()
  const nav = useNavigate()
  const letter = useStore((s) => s.letters.find((l) => l.id === letterId))
  const home = useStore((s) => s.homeCity)
  const friends = useStore((s) => s.friends)
  const bird = useStore((s) => s.bird)
  const user = useStore((s) => s.user)
  if (!letter) return <Navigate to="/mailbox" replace />

  const mine = letter.fromId === 'me'
  const other = friends.find((f) => f.id === (mine ? letter.toId : letter.fromId))
  const km = home && other ? Math.round(haversineKm(home, other)) : 0
  const shown = (a: Attachment) => !!(a.dataUrl || a.key)
  const images = letter.attachments.filter((a) => shown(a) && a.type?.startsWith('image/'))
  const files = letter.attachments.filter((a) => !a.type?.startsWith('image/') || !shown(a))
  const d = new Date(letter.dateMs)
  const first = (user?.name ?? 'friend').split(' ')[0]
  const sender = letter.fromName.split(' ')[0]

  function toggleSave() {
    const saved = !letter!.saved
    setState({ letters: getState().letters.map((l) => (l.id === letter!.id ? { ...l, saved } : l)) })
    void send({ id: `letter-save:${letter!.id}`, method: 'PUT', path: `/letters/${letter!.id}`, body: { saved } })
  }

  async function share() {
    const text = `A letter from ${letter!.fromName} (${letter!.fromCity}) on Pigeon Post`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Pigeon Post', text })
      } catch {
        // dismissed
      }
    } else {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        // clipboard unavailable
      }
    }
  }

  async function download(a: Attachment) {
    const href = await attachmentUrl(a).catch(() => undefined)
    if (!href) return
    const el = document.createElement('a')
    el.href = href
    el.target = '_blank' // a presigned URL is cross-origin, where browsers ignore `download`
    el.rel = 'noopener'
    el.download = a.name
    el.click()
  }

  return (
    <Frame>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-cream/85 px-4 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-[12px]">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => nav('/mailbox')} aria-label="Go back" className="flex size-11 items-center justify-center rounded-full">
            <img src="/assets/tc-back.svg" alt="" className="size-4" />
          </button>
          <h1 className="font-serif text-[20px] font-semibold leading-7 tracking-[-0.5px] text-ink">Opened Letter</h1>
        </div>
        <Link to="/settings/profile" aria-label="Profile" className="flex size-11 items-center justify-center">
          <img src="/assets/profile.jpg" alt="" className="size-8 rounded-full shadow-[0_0_0_2px_rgba(127,163,138,0.4)]" />
        </Link>
      </header>

      <main className="flex-1">
        <div className="flex items-center justify-between px-5 pb-2 pt-1">
          <div className="flex items-center gap-1">
            <span className="flex items-center gap-1 rounded-full bg-sky px-2 py-1 text-[12px] font-semibold tracking-[0.36px] text-[#4d6876]">
              <img src="/assets/ol-airmail.svg" alt="" className="h-[11.3px] w-[13.1px]" />
              Airmail Delivered
            </span>
            <span className="-rotate-1 font-hand text-[22px] font-medium leading-7 text-[#8e4d31] opacity-80">~ {km.toLocaleString('en-US')} km</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={playRustle} aria-label="Play paper rustle" className="flex size-10 items-center justify-center rounded-full bg-[#efe7e1] shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <img src="/assets/ol-sound.svg" alt="" className="h-[14.6px] w-[15px]" />
            </button>
            <button type="button" onClick={() => void share()} aria-label="Share letter keepsake" className="flex size-10 items-center justify-center rounded-full bg-[#efe7e1] shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <img src="/assets/ol-share.svg" alt="" className="h-[17.5px] w-[13.3px]" />
            </button>
          </div>
        </div>

        <div className="px-5 py-1">
          <article className="relative overflow-hidden rounded-xl bg-white px-6 pb-16 pt-6 shadow-[0_12px_32px_-6px_rgba(62,58,54,0.14),0_2px_8px_rgba(62,58,54,0.06)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-b from-[rgba(244,236,230,0.6)] to-transparent" />
            <div className="flex items-start justify-between">
              <div className="pt-1">
                <p className="font-serif text-[20px] font-semibold leading-7 tracking-[-0.5px] text-ink">
                  {letter.fromCity}, {d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
                </p>
                <p className="-rotate-2 font-hand text-[22px] font-medium leading-7 text-sage">
                  Morning post via carrier {mine ? (bird?.name ?? 'Pip') : (bird?.name ?? 'Pip')}
                  <br />
                  🕊️
                </p>
              </div>
              <div className="relative flex shrink-0 flex-col items-end">
                <div className="relative flex h-24 w-20 flex-col items-center justify-between overflow-hidden rounded-[2px] bg-card-soft p-1 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                  <div className="flex w-full items-center justify-between px-1 pt-1">
                    <span className="max-w-[44px] truncate text-[10px] font-bold uppercase tracking-[1px] text-[#8e4d31]">{countryName(letter.cc)}</span>
                    <span className="flex h-2 w-3 items-center justify-center rounded-[1px] bg-line">
                      <span className="size-1.5 rounded-full bg-[#ba1a1a]" />
                    </span>
                  </div>
                  <span className="flex size-12 items-center justify-center rounded-full bg-[#ffdbcd] shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]">
                    <img src="/assets/ol-plane.svg" alt="" className="size-[21.7px]" />
                  </span>
                  <div className="flex w-full items-center justify-between pb-1 pl-1">
                    <span className="text-[9px] text-sky-ink">AIRMAIL</span>
                    <span className="font-serif text-[12px] font-bold text-[#8e4d31]">{letter.cc}</span>
                  </div>
                </div>
                <svg viewBox="0 0 96 96" className="pointer-events-none absolute -bottom-6 -left-9 size-24 -rotate-12 opacity-85" aria-hidden>
                  <circle cx="48" cy="48" r="44" fill="none" stroke="#476270" strokeWidth="1.5" />
                  <circle cx="48" cy="48" r="38" fill="none" stroke="#476270" strokeWidth="1" />
                  <defs>
                    <path id="pm-arc" d="M 14 48 A 34 34 0 0 1 82 48" />
                  </defs>
                  <text fontSize="8" fill="#476270" letterSpacing="1.5">
                    <textPath href="#pm-arc" startOffset="50%" textAnchor="middle">
                      {letter.fromCity.toUpperCase()} AIR POST
                    </textPath>
                  </text>
                  <line x1="26" y1="44" x2="70" y2="44" stroke="#476270" />
                  <text x="48" y="52" fontSize="8" fill="#476270" textAnchor="middle">
                    {d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                  </text>
                  <line x1="26" y1="56" x2="70" y2="56" stroke="#476270" />
                </svg>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-10 font-hand font-medium tracking-[0.55px] text-[#572309]">
              <p className="text-[24px] leading-[39px]">Dear {mine ? (other?.name.split(' ')[0] ?? 'friend') : first},</p>
              <p className="whitespace-pre-wrap text-[23px] leading-[37px]">{letter.text || '(no words, only a little something enclosed)'}</p>
              <div className="flex flex-col items-end gap-1.5 pr-4 pt-1">
                <p className="text-[21px] leading-[34px] text-[#8e4d31]">With warm wishes across the clouds,</p>
                <p className="-rotate-1 text-[28px] font-bold leading-[45px] text-ink">{sender}</p>
              </div>
            </div>

            {(images.length > 0 || files.length > 0) && (
              <div className="mt-6 flex flex-col gap-3">
                {images.map((a, i) => (
                  <div key={`${a.name}-${i}`} className="flex flex-col items-center">
                    <figure className={`relative w-[280px] max-w-full bg-white p-3 shadow-[0_6px_16px_-3px_rgba(62,58,54,0.12),0_1px_4px_rgba(62,58,54,0.06)] ${i % 2 ? '-rotate-1' : 'rotate-[1.5deg]'}`}>
                      <AttachedImage a={a} />
                      <figcaption className="pt-2 text-center font-hand text-[22px] font-medium leading-7 text-ink-2">{a.name.replace(/\.[^.]+$/, '')}</figcaption>
                      <span className="absolute -top-4 left-1/2 h-6 w-28 -translate-x-1/2 -rotate-2 rounded-[1px] bg-[rgba(255,219,205,0.8)] shadow-[0_1px_2px_rgba(0,0,0,0.05)]" aria-hidden />
                    </figure>
                  </div>
                ))}
                {files.map((a, i) => (
                  <div key={`${a.name}-${i}`} className="relative flex items-center justify-between rounded-lg bg-card py-2 pl-4 pr-2 drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                    <img src="/assets/ol-clip.svg" alt="" className="absolute -top-3.5 left-5 h-[42px] w-[22px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.18)]" />
                    <div className="flex min-w-0 items-center gap-2 pl-4">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-line">
                        <img src="/assets/ol-pdf.svg" alt="" className="h-[16.7px] w-[13.3px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-bold tracking-[0.28px] text-ink">{a.name}</span>
                        <span className="block text-[12px] font-semibold tracking-[0.36px] text-ink-2 opacity-80">{(a.size / 1048576).toFixed(1)} MB • Attachment</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void download(a)}
                      disabled={!shown(a)}
                      title={shown(a) ? 'Download' : 'This file was too large to keep offline'}
                      className="ml-2 flex shrink-0 items-center gap-1 rounded-full bg-line px-2 py-1.5 text-[12px] font-semibold tracking-[0.36px] text-sage shadow-[0_1px_1px_rgba(0,0,0,0.05)] disabled:opacity-50"
                    >
                      <img src="/assets/ol-download.svg" alt="" className="size-[10.7px]" />
                      Download
                    </button>
                  </div>
                ))}
              </div>
            )}

            <span className="absolute bottom-3 right-5 flex size-11 rotate-12 items-center justify-center rounded-full bg-[#d58767] opacity-90 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)]" aria-hidden>
              <img src="/assets/ol-paw.svg" alt="" className="h-[17.4px] w-[18.3px]" />
            </span>
          </article>
        </div>

        <div className="flex flex-col gap-2 px-5 pb-6 pt-4">
          {other && !mine ? (
            <button type="button" onClick={() => nav(`/trip/new?friend=${other.id}&letter=1`)} className="flex h-14 w-full items-center justify-center gap-1 rounded-full bg-[#8e4d31] text-[14px] font-bold tracking-[0.28px] text-white shadow-[0_4px_7px_rgba(142,77,49,0.28)]">
              <img src="/assets/ol-reply.svg" alt="" className="h-[13.3px] w-[15px]" />
              Reply with letter
            </button>
          ) : null}
          <div className="flex gap-2">
            <button type="button" onClick={toggleSave} aria-pressed={!!letter.saved} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-card text-[14px] font-bold tracking-[0.28px] text-ink shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <img src="/assets/ol-bookmark.svg" alt="" className="h-[13.5px] w-[10.5px]" />
              {letter.saved ? 'Saved' : 'Save to Keepsakes'}
            </button>
            <button type="button" onClick={() => nav('/mailbox')} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-[#efe7e1] text-[14px] font-bold tracking-[0.28px] text-ink-2 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <img src="/assets/ol-folder.svg" alt="" className="h-3 w-[16.1px]" />
              Close letter
            </button>
          </div>
        </div>
      </main>
    </Frame>
  )
}
