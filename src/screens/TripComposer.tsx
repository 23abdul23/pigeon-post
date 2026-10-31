import Avatar from '../components/Avatar'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Flag from '../components/Flag'
import { Frame } from '../components/Layout'
import { DesktopBar } from '../components/Header'
import MiniMap from '../components/MiniMap'
import PlaceMapPicker from '../components/PlaceMapPicker'
import PlaceSearch from '../components/PlaceSearch'
import { birdBySpecies } from '../lib/birds'
import { startSession } from '../lib/flight'
import { fmtKm, haversineKm } from '../lib/geo'
import { COGNITO_CONFIGURED } from '../lib/auth'
import { avatarColor, initials, uploadAttachment, writeLetter } from '../lib/social'
import { useStore, type Letter, type Place } from '../lib/store'
import { openPopup, popupSupported } from '../lib/pip'
import { createTrip, tripProblem } from '../lib/trips'

const MAX_CHARS = 600
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED = ['image/png', 'image/jpeg', 'application/pdf']
const MAX_FILES = 3 // the API's limit per letter

type SR = { start: () => void; stop: () => void; continuous: boolean; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null }
const speechCtor = (): (new () => SR) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const readDataUrl = (f: File) =>
  new Promise<string | undefined>((res) => {
    if (f.size > 700 * 1024) return res(undefined) // keep localStorage small
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => res(undefined)
    r.readAsDataURL(f)
  })

export default function TripComposer() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const bird = useStore((s) => s.bird)
  const home = useStore((s) => s.homeCity)
  const friends = useStore((s) => s.friends).filter((f) => f.status === 'accepted')
  const species = birdBySpecies(bird?.species ?? 'pigeon')
  const preFriend = params.get('friend')
  const [mode, setMode] = useState<'place' | 'friend'>(preFriend ? 'friend' : 'place')
  const [friendId, setFriendId] = useState<string | null>(preFriend && friends.some((f) => f.id === preFriend) ? preFriend : null)
  const [place, setPlace] = useState<Place | null>(() => {
    const raw = params.get('place')
    if (!raw) return null
    const [name, country, cc, lat, lng] = raw.split('|')
    return { id: `p-${name}-${lat}`, name, country, cc, lat: Number(lat), lng: Number(lng) }
  })
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Letter['attachments']>([])
  const [error, setError] = useState('')
  const [courseError, setCourseError] = useState('')
  const [mapOpen, setMapOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [listening, setListening] = useState(false)
  const rec = useRef<SR | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const letterOnly = params.get('letter') === '1'
  const canDictate = useMemo(() => speechCtor() !== null, [])

  const friend = friends.find((f) => f.id === friendId) ?? null
  const dest: Place | null =
    mode === 'friend' && friend
      ? { id: `friend-${friend.id}`, name: friend.city, country: friend.cc, cc: friend.cc, lat: friend.lat, lng: friend.lng }
      : mode === 'place'
        ? place
        : null
  const km = home && dest ? Math.round(haversineKm(home, dest)) : 0
  const minutes = Math.max(1, Math.round(km / 100))
  const sessions = Math.max(1, Math.ceil(minutes / 25))

  useEffect(() => () => rec.current?.stop(), [])

  function toggleDictation() {
    const C = speechCtor()
    if (!C) return
    if (listening) {
      rec.current?.stop()
      return
    }
    const r = new C()
    r.continuous = true
    r.interimResults = false
    r.onresult = (e) => {
      const said = Array.from(e.results as ArrayLike<ArrayLike<{ transcript: string }>>)
        .map((x) => x[0].transcript)
        .join(' ')
        .trim()
      if (said) setText((t) => (`${t} ${said}`.trim()).slice(0, MAX_CHARS))
    }
    r.onend = () => setListening(false)
    rec.current = r
    try {
      r.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list) return
    setError('')
    const next = [...files]
    setUploading(true)
    for (const f of Array.from(list)) {
      if (next.length >= MAX_FILES) {
        setError(`A letter can carry up to ${MAX_FILES} files.`)
        break
      }
      if (!ALLOWED.includes(f.type)) {
        setError(`${f.name} isn't allowed. Use a PNG, JPG or PDF.`)
        continue
      }
      if (f.size > MAX_BYTES) {
        setError(`${f.name} is over 5 MB. Choose a smaller file.`)
        continue
      }
      const dataUrl = await readDataUrl(f)
      if (!COGNITO_CONFIGURED) {
        next.push({ name: f.name, size: f.size, type: f.type, dataUrl })
        continue
      }
      try {
        // the file goes straight to private storage; the letter carries its key (and a small local preview)
        next.push({ ...(await uploadAttachment(f)), dataUrl })
      } catch {
        setError(`${f.name} could not be uploaded. Check your connection and try again.`)
      }
    }
    setUploading(false)
    setFiles(next)
    if (fileInput.current) fileInput.current.value = ''
  }

  function start(withLetter: boolean) {
    if (!dest) {
      setCourseError(mode === 'friend' ? 'Choose a friend to fly to.' : 'Pick a place to fly to first.')
      return
    }
    const problem = tripProblem(dest) // before the letter is written, so a refused trip leaves no letter behind
    if (problem) {
      setCourseError(problem)
      return
    }
    // the letter first, so the trip (and POST /trips) carries its id
    const letter = friend && withLetter && (text.trim() || files.length) ? writeLetter({ toId: friend.id, text: text.trim(), attachments: files, status: 'CARRIED' }) : null
    const trip = createTrip(dest, { friendId: friend?.id, letterIds: letter ? [letter.id] : [] })
    if (popupSupported()) void openPopup()
    startSession(trip, 25)
    nav(`/fly/${trip.id}`)
  }

  function saveLetterOnly() {
    if (!friend) return setError('Choose a friend first.')
    if (!text.trim() && !files.length) return setError('Write a few words first.')
    writeLetter({ toId: friend.id, text: text.trim(), attachments: files, status: 'WAITING' })
    nav('/mailbox?box=sent')
  }

  const showLetter = mode === 'friend' && !!friend

  return (
    <Frame nav>
      <DesktopBar />
      <header className="lg:hidden sticky top-0 z-30 flex h-16 items-center justify-between bg-cream/85 px-4 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-[12px]">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => nav(-1)} aria-label="Go back" className="flex size-11 items-center justify-center rounded-full">
            <img src="/assets/tc-back.svg" alt="" className="size-4" />
          </button>
          <h1 className="font-serif text-[20px] font-semibold leading-7 tracking-[-0.5px] text-ink">Trip Composer</h1>
        </div>
        <Link to="/settings/profile" aria-label="Profile" className="flex size-11 items-center justify-center">
          <Avatar className="size-8 shadow-[0_0_0_2px_rgba(127,163,138,0.4)]" />
        </Link>
      </header>

      <main className="lg:max-w-[760px] flex-1 px-5 pb-10 pt-1">
        <div className="pb-4 pt-1">
          <div className="flex flex-col gap-4 rounded-xl bg-card p-4 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <ol className="flex items-center" aria-label="Trip steps">
              <Step n="1. " label={species.name} state="done" icon="/assets/tc-check.svg" iw="h-2 w-[10.9px]" />
              <span className="mb-4 h-0.5 flex-1 bg-sage opacity-70" />
              <Step n="2. " label="Course" state="active" icon="/assets/tc-compass.svg" iw="size-[13.3px]" />
              <span className={`mb-4 h-0.5 flex-1 ${showLetter ? 'bg-sage opacity-70' : 'bg-line'}`} />
              <Step n="3. " label="Letter" state={showLetter ? 'active' : 'todo'} icon="/assets/tc-letter.svg" iw="h-[10.7px] w-3" />
            </ol>
            <div className="flex items-center justify-between rounded-lg bg-white/80 px-4 py-1 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <span className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-[rgba(170,207,181,0.5)]">
                  <img src="/assets/tc-carrier.svg" alt="" className="h-[16.5px] w-[13.3px]" />
                </span>
                <span className="text-[12px] font-semibold tracking-[0.36px] text-ink">
                  Carrier: <span className="font-normal">{bird?.name ?? 'Pip'}</span> <span className="font-normal text-ink-2">({species.name})</span>
                </span>
              </span>
              <Link to="/onboarding/bird?from=settings" className="text-[12px] font-semibold tracking-[0.36px] text-[#8e4d31]">
                Change bird
              </Link>
            </div>
          </div>
        </div>

        <section className="flex flex-col gap-2 rounded-xl bg-card-soft p-4 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
          <div className="flex h-7 items-center justify-between">
            <h2 className="flex items-center gap-2 font-serif text-[20px] font-semibold leading-7 text-ink">
              <img src="/assets/tc-nav.svg" alt="" className="size-[15px]" />
              Where to?
            </h2>
            <span className="-rotate-2 font-hand text-[22px] font-medium text-[#8e4d31]">{dest ? 'flight map set' : 'pick a course'}</span>
          </div>

          <div className="flex rounded-full bg-line p-1" role="radiogroup" aria-label="Destination type">
            {(['place', 'friend'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => (setMode(m), setCourseError(''))}
                className={`flex flex-1 items-center justify-center gap-1 rounded-full py-1.5 text-[12px] tracking-[0.36px] ${mode === m ? 'bg-white font-bold text-ink shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'font-semibold text-ink-2'}`}
              >
                {m === 'place' ? 'A place' : 'A friend'}
                {mode === m && <span className="size-1.5 rounded-full bg-[#d58767]" />}
              </button>
            ))}
          </div>

          {mode === 'place' ? (
            <div className="pt-2">
              <div className="flex items-center gap-2">
                <PlaceSearch kind="any" value={place} onChange={(p) => (setPlace(p), setCourseError(''))} />
                <button
                  type="button"
                  onClick={() => setMapOpen((o) => !o)}
                  aria-expanded={mapOpen}
                  className="shrink-0 rounded-full bg-white px-3 py-2.5 text-[12px] font-bold tracking-[0.36px] text-[#8e4d31] shadow-[0_1px_1px_rgba(0,0,0,0.05)]"
                >
                  Pick on map
                </button>
              </div>
              {mapOpen && (
                <PlaceMapPicker
                  kind="any"
                  initial={home ? [home.lat, home.lng] : undefined}
                  onPick={(p) => (setPlace(p), setCourseError(''), setMapOpen(false))}
                  onClose={() => setMapOpen(false)}
                />
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 pt-2">
              {friends.length === 0 && (
                <p className="rounded-xl bg-white p-3 text-center text-[14px] text-ink-2">
                  No friends yet.{' '}
                  <Link to="/friends" className="font-bold text-sage">
                    Add one
                  </Link>{' '}
                  to send letters.
                </p>
              )}
              {friends.map((f) => {
                const on = f.id === friendId
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => (setFriendId(f.id), setCourseError(''))}
                    aria-pressed={on}
                    className={`flex items-center justify-between rounded-xl p-2.5 text-left ${on ? 'bg-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'bg-[rgba(239,231,225,0.6)] opacity-80'}`}
                  >
                    <span className="flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-full text-[14px] font-bold text-[#360f00]" style={{ background: avatarColor(f.id) }}>
                        {initials(f.name)}
                      </span>
                      <span>
                        <span className="flex items-center gap-1.5 text-[14px] font-bold tracking-[0.28px] text-ink">
                          {f.name}
                          <Flag cc={f.cc} className="w-4" />
                        </span>
                        <span className="block text-[14px] leading-5 text-ink-2">{f.city}, {f.cc}</span>
                      </span>
                    </span>
                    {on ? (
                      <span className="flex size-6 items-center justify-center rounded-full bg-sage shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                        <img src="/assets/tc-check-friend.svg" alt="Selected" className="h-[7.5px] w-[10.2px]" />
                      </span>
                    ) : (
                      <span className="size-5 rounded-full bg-line" />
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {courseError && (
            <p role="alert" className="px-1 text-[13px] text-[#ba1a1a]">
              {courseError}
            </p>
          )}

          {dest && home && (
            <div className="mt-2 overflow-hidden rounded-xl bg-line shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <MiniMap center={{ lat: (home.lat + dest.lat) / 2, lng: (home.lng + dest.lng) / 2 }} zoom={km > 6000 ? 0.6 : km > 2000 ? 1.6 : 3} className="h-32">
                <div className="absolute inset-0 bg-gradient-to-t from-line to-transparent" />
                <span className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.3px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px]">
                  <img src="/assets/tc-route-pin.svg" alt="" className="h-[11px] w-[9.3px]" />
                  Route: {fmtKm(km)}
                </span>
                <span className="absolute right-2.5 top-2.5 flex size-7 items-center justify-center rounded-full bg-white/90 shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px]">
                  <img src="/assets/tc-emblem.svg" alt="" className="size-[15px]" />
                </span>
              </MiniMap>
              <div className="flex items-center justify-between bg-line p-3">
                <span className="flex items-center gap-2">
                  <span className="flex h-7 w-[27px] items-center justify-center rounded-full bg-[#7fa38a]">
                    <img src="/assets/tc-hourglass.svg" alt="" className="h-[13.3px] w-[10.7px]" />
                  </span>
                  <span>
                    <span className="block text-[12px] font-bold tracking-[0.36px] text-ink">About {minutes} min of focus</span>
                    <span className="block text-[14px] leading-5 text-ink-2">
                      Split into {sessions} calm session{sessions > 1 ? 's' : ''}
                    </span>
                  </span>
                </span>
                <span className="font-hand text-[22px] font-medium leading-7 text-[#8e4d31]">fair winds!</span>
              </div>
            </div>
          )}
        </section>

        {(showLetter || letterOnly) && friend && (
          <section className="mt-4 flex flex-col gap-2 rounded-xl bg-card-soft p-4 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]">
            <div className="flex h-[52px] items-center justify-between">
              <div className="flex items-center gap-2">
                <img src="/assets/tc-envelope.svg" alt="" className="size-[18.3px]" />
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.6px] text-muted">Step 3 • Letter</p>
                </div>
              </div>
              
            </div>

            <div className="relative flex flex-col gap-3 overflow-hidden rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <div className="flex items-center justify-between rounded-lg bg-[rgba(250,242,236,0.5)] px-3 pb-2 pt-1.5">
                <span className="flex items-center gap-1.5">
                  <span className="text-[12px] font-bold tracking-[0.36px] text-ink-2">To:</span>
                  <span className="flex items-center gap-1 text-[14px] font-bold tracking-[0.28px] text-ink">
                    {friend.name} ({friend.city} <Flag cc={friend.cc} className="w-3.5" />)
                  </span>
                </span>
                <img src="/assets/tc-lock.svg" alt="Recipient is locked" className="h-3.5 w-[10.7px]" />
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
                placeholder="Dear friend, ..."
                aria-label="Letter text"
                rows={5}
                className="w-full resize-none bg-[repeating-linear-gradient(transparent,transparent_27px,rgba(30,27,24,0.08)_27px,rgba(30,27,24,0.08)_28px)] pb-7 font-hand text-[22px] font-medium leading-7 text-ink outline-none placeholder:text-muted"
              />
              <div className="flex flex-col gap-2 pt-1.5">
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="flex items-center gap-0.5 text-[12px] font-semibold tracking-[0.36px] text-[#8e4d31]">
                    <img src="/assets/tc-paperclip.svg" alt="" className="h-[12.5px] w-[7.8px]" />
                    {uploading ? 'Uploading...' : 'Attach Leaves & Notes'}
                  </button>
                  <input ref={fileInput} type="file" accept=".png,.jpg,.jpeg,.pdf" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
                </div>
                <div className="flex flex-col items-start gap-2">
                  {files.map((f, i) => (
                    <span key={`${f.name}-${i}`} className="flex max-w-full items-center gap-1.5 rounded-full bg-card px-2.5 py-1">
                      <img src={f.type === 'application/pdf' ? '/assets/tc-clip-pdf.svg' : '/assets/tc-clip-img.svg'} alt="" className="h-[13.3px] w-[9px]" />
                      <span className="max-w-[150px] truncate text-[14px] text-ink">{f.name}</span>
                      <span className="whitespace-nowrap text-[12px] text-muted">({(f.size / 1048576).toFixed(1)} MB)</span>
                      <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="pl-1">
                        <img src="/assets/tc-x.svg" alt="" className="size-2" />
                      </button>
                    </span>
                  ))}
                </div>
                {error && (
                  <p role="alert" className="text-[13px] text-[#ba1a1a]">
                    {error}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between pt-3">
                {canDictate ? (
                  <button type="button" onClick={toggleDictation} aria-pressed={listening} className="flex items-center gap-2 rounded-full bg-sky px-3 py-1.5 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                    {listening && (
                      <span className="relative flex size-2.5">
                        <span className="absolute inset-0 animate-ping rounded-full bg-sky-ink opacity-75" />
                        <span className="relative size-2.5 rounded-full bg-sky-ink" />
                      </span>
                    )}
                    <img src="/assets/tc-mic.svg" alt="" className="h-[12.7px] w-[9.3px]" />
                    <span className="text-[12px] font-semibold tracking-[0.36px] text-[#4d6876]">{listening ? 'Listening...' : 'Dictate'}</span>
                  </button>
                ) : (
                  <span />
                )}
                <span className="text-[14px] tracking-[0.7px] text-muted">
                  {text.length} / {MAX_CHARS}
                </span>
              </div>
            </div>

            <p className="flex items-center gap-2 px-1 text-[14px] italic leading-5 text-ink-2">
              <img src="/assets/tc-note.svg" alt="" className="h-3 w-[12.7px] shrink-0" />
              {letterOnly ? `${friend.name}'s bird will pick this up when it visits you.` : `Letter will be delivered when your bird arrives in ${friend.city}.`}
            </p>
          </section>
        )}

        <div className="flex items-center justify-between pt-5">
          <Link to="/home" className="px-3 py-2 text-[14px] font-bold tracking-[0.28px] text-ink-2">
            Back
          </Link>
          <div className="flex items-center gap-2">
            {showLetter && !letterOnly && (
              <button type="button" onClick={() => start(false)} className="rounded-full bg-card px-4 py-2.5 text-[14px] font-bold tracking-[0.28px] text-ink shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                Skip letter
              </button>
            )}
            {letterOnly ? (
              <button type="button" onClick={saveLetterOnly} disabled={uploading} className="flex disabled:opacity-60 items-center gap-2 rounded-full bg-[#d58767] px-6 py-2.5 text-[14px] font-bold tracking-[0.28px] text-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)]">
                Send letter
              </button>
            ) : (
              <button type="button" onClick={() => start(true)} disabled={uploading} className="flex disabled:opacity-60 items-center gap-2 rounded-full bg-[#d58767] px-6 py-2.5 text-[14px] font-bold tracking-[0.28px] text-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]">
                Start flight
                <img src="/assets/tc-plane.svg" alt="" className="h-[13.6px] w-[15.5px]" />
              </button>
            )}
          </div>
        </div>
      </main>
    </Frame>
  )
}

function Step({ n, label, state, icon, iw }: { n: string; label: string; state: 'done' | 'active' | 'todo'; icon: string; iw: string }) {
  const circle =
    state === 'done'
      ? 'bg-sage shadow-[0_1px_1px_rgba(0,0,0,0.05)]'
      : state === 'active'
        ? 'bg-[#d58767] shadow-[0_0_0_4px_rgba(255,219,205,0.4),0_1px_2px_rgba(0,0,0,0.05)]'
        : 'bg-line'
  const text = state === 'done' ? 'font-bold text-sage' : state === 'active' ? 'font-bold text-ink' : 'font-semibold text-muted'
  return (
    <li className="flex flex-1 flex-col items-center gap-1" aria-current={state === 'active' ? 'step' : undefined}>
      <span className={`flex size-7 items-center justify-center rounded-full ${circle}`}>
        <img src={icon} alt="" className={iw} />
      </span>
      <span className={`whitespace-nowrap text-[12px] tracking-[0.36px] ${text}`}>
        {n}
        {label}
      </span>
    </li>
  )
}
