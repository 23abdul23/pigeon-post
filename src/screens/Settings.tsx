import { useEffect, useRef, useState, type ReactNode } from 'react'
import { COGNITO_CONFIGURED, signOut as cognitoSignOut } from '../lib/auth'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import BirdViewer from '../components/BirdViewer'
import Flag from '../components/Flag'
import { Frame } from '../components/Layout'
import { birdBySpecies } from '../lib/birds'
import { DEMO_MODE, loadDemoData } from '../lib/demo'
import { playCoo } from '../lib/sound'
import { setState, useStore, type Settings as SettingsT } from '../lib/store'
import { deleteAccount as deleteServerAccount, saveProfile } from '../lib/sync'
import { clearOutbox } from '../lib/outbox'

const SECTIONS = [
  ['profile', 'Profile'],
  ['city', 'Home city'],
  ['birds', 'Birds'],
  ['sound', 'Sound'],
  ['notifications', 'Alerts'],
  ['privacy', 'Privacy'],
  ['account', 'Account'],
] as const

export default function Settings() {
  const { section } = useParams()
  const nav = useNavigate()
  const user = useStore((s) => s.user)
  const home = useStore((s) => s.homeCity)
  const bird = useStore((s) => s.bird)
  const soundOn = useStore((s) => s.soundOn)
  const saved = useStore((s) => s.settings)
  const [draft, setDraft] = useState<SettingsT>(saved)
  const [name, setName] = useState(user?.name ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [toast, setToast] = useState('')
  const refs = useRef<Record<string, HTMLElement | null>>({})

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved) || name.trim() !== (user?.name ?? '')
  const species = birdBySpecies(bird?.species ?? 'pigeon')

  useEffect(() => {
    if (section) refs.current[section]?.scrollIntoView({ block: 'start' })
  }, [section])

  function set<K extends keyof SettingsT>(k: K, v: SettingsT[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  function save() {
    const trimmed = name.trim() || user?.name || 'Traveler'
    setState({ settings: draft, user: user ? { ...user, name: trimmed } : user })
    saveProfile()
    setName(trimmed)
    flash('Changes saved.')
  }

  function cancel() {
    setDraft(saved)
    setName(user?.name ?? '')
  }

  function flash(m: string) {
    setToast(m)
    window.setTimeout(() => setToast(''), 2500)
  }

  async function browserAlerts() {
    set('channel', 'browser')
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission()
      } catch {
        // permission prompt unavailable
      }
    }
  }

  function signOut() {
    setState({ user: null })
    clearOutbox()
    if (COGNITO_CONFIGURED) return void cognitoSignOut()
    nav('/signin', { replace: true })
  }

  async function deleteAccount() {
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteServerAccount()
    } catch {
      setDeleting(false)
      setDeleteError("Your account wasn't deleted. Check your connection and try again.")
      return
    }
    if (COGNITO_CONFIGURED) return void cognitoSignOut()
    nav('/signin', { replace: true, state: { farewell: true } })
  }

  return (
    <Frame>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-cream/85 px-2 shadow-[0_1px_8px_rgba(62,58,54,0.04)] backdrop-blur-[12px]">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => nav(-1)} aria-label="Go back" className="flex size-11 items-center justify-center rounded-full">
            <img src="/assets/tc-back.svg" alt="" className="size-4" />
          </button>
          <h1 className="font-serif text-[20px] font-semibold leading-7 text-ink">Settings</h1>
        </div>
        <Link to="/home" className="px-3 text-[14px] font-bold text-sage">
          Done
        </Link>
      </header>

      <nav aria-label="Settings sections" className="sticky top-16 z-20 flex gap-2 overflow-x-auto bg-cream/90 px-4 py-2 backdrop-blur-[12px]">
        {SECTIONS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => refs.current[k]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-bold tracking-[0.36px] ${section === k ? 'bg-sage text-white' : 'bg-card text-ink-2'}`}
          >
            {l}
          </button>
        ))}
      </nav>

      <main className="flex flex-1 flex-col gap-4 px-4 pb-32 pt-2">
        <Card id="profile" title="Profile" refs={refs}>
          <div className="flex items-center gap-4">
            <Avatar className="size-16 shadow-[0_0_0_2px_rgba(127,163,138,0.4)]" />
            <div className="min-w-0 flex-1">
              <label htmlFor="display-name" className="text-[12px] font-bold tracking-[0.36px] text-ink-2">
                Display name
              </label>
              <input id="display-name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl bg-white px-3 py-2.5 text-[16px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] outline-none focus:ring-2 focus:ring-sage/40" />
            </div>
          </div>
          <label htmlFor="bio" className="pt-3 text-[12px] font-bold tracking-[0.36px] text-ink-2">
            Short bio
          </label>
          <textarea id="bio" value={draft.bio} maxLength={120} rows={2} onChange={(e) => set('bio', e.target.value)} placeholder="A line your friends will see" className="mt-1 w-full resize-none rounded-xl bg-white px-3 py-2.5 text-[14px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] outline-none placeholder:text-muted focus:ring-2 focus:ring-sage/40" />
          <p className="pt-1 text-right text-[12px] text-muted">{draft.bio.length} / 120</p>
        </Card>

        <Card id="city" title="Home city" refs={refs}>
          <div className="flex items-center justify-between rounded-xl bg-white p-3 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <span className="flex items-center gap-3">
              {home && <Flag cc={home.cc} className="w-6" />}
              <span>
                <span className="block font-serif text-[18px] leading-6 text-ink">{home?.name ?? 'Not set'}</span>
                <span className="block text-[13px] text-ink-2">{home?.country}</span>
              </span>
            </span>
            <Link to="/onboarding/city?from=settings" className="rounded-full bg-card px-3.5 py-1.5 text-[12px] font-bold text-sage">
              Change
            </Link>
          </div>
          <p className="pt-2 text-[13px] leading-5 text-ink-2">Changing it affects where your bird starts and returns. A trip already in the air keeps its old origin.</p>
        </Card>

        <Card id="birds" title="Birds" refs={refs}>
          <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <BirdViewer bird={species} className="h-20 w-24 shrink-0 rounded-lg bg-card-soft" />
            <div className="min-w-0 flex-1">
              <p className="font-serif text-[18px] leading-6 text-ink">{bird?.name ?? 'Pip'}</p>
              <p className="text-[13px] text-ink-2">
                {species.name}
              </p>
            </div>
            <Link to="/onboarding/bird?from=settings" className="rounded-full bg-card px-3.5 py-1.5 text-[12px] font-bold text-sage">
              Change bird
            </Link>
          </div>
        </Card>

        <Card id="sound" title="Sound" refs={refs}>
          <Row label="Master sound" hint="Mutes every sound in the app">
            <Switch on={soundOn} onChange={(v) => setState({ soundOn: v })} label="Master sound" />
          </Row>
          <div className="py-2">
            <label htmlFor="vol" className="flex items-center justify-between text-[14px] font-bold text-ink">
              Volume
              <span className="text-[12px] font-normal text-muted">{draft.volume}%</span>
            </label>
            <input id="vol" type="range" min={0} max={100} value={draft.volume} onChange={(e) => set('volume', Number(e.target.value))} className="mt-2 w-full accent-[#446650]" />
          </div>
          <Row label="Bird coo on landing">
            <Switch on={draft.coo} onChange={(v) => set('coo', v)} label="Bird coo on landing" />
          </Row>
          <Row label="Paper rustle when opening letters">
            <Switch on={draft.rustle} onChange={(v) => set('rustle', v)} label="Paper rustle when opening letters" />
          </Row>
          <Row label="Flight ambience">
            <Switch on={draft.ambience} onChange={(v) => set('ambience', v)} label="Flight ambience" />
          </Row>
          <button type="button" onClick={() => playCoo(true)} className="mt-2 rounded-full bg-white px-4 py-2 text-[12px] font-bold text-sage shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            Play a test coo
          </button>
        </Card>

        <Card id="notifications" title="Notifications" refs={refs}>
          <Row label="A letter arrived">
            <Switch on={draft.notifyLetter} onChange={(v) => set('notifyLetter', v)} label="A letter arrived" />
          </Row>
          <Row label="A friend's bird is nearby">
            <Switch on={draft.notifyBird} onChange={(v) => set('notifyBird', v)} label="A friend's bird is nearby" />
          </Row>
          <Row label="Friend request">
            <Switch on={draft.notifyFriend} onChange={(v) => set('notifyFriend', v)} label="Friend request" />
          </Row>
          <div className="pt-2" role="radiogroup" aria-label="Delivery">
            <p className="pb-1 text-[12px] font-bold tracking-[0.36px] text-ink-2">Deliver by</p>
            <div className="flex rounded-full bg-line p-1">
              {(['email', 'browser'] as const).map((c) => (
                <button key={c} type="button" role="radio" aria-checked={draft.channel === c} onClick={() => (c === 'browser' ? void browserAlerts() : set('channel', c))} className={`flex-1 rounded-full py-1.5 text-[13px] font-bold ${draft.channel === c ? 'bg-white text-ink shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'text-ink-2'}`}>
                  {c === 'email' ? 'Email' : 'In the browser'}
                </button>
              ))}
            </div>
          </div>
          <p className="pt-2 text-[12px] text-muted">No alerts arrive during a focus flight.</p>
        </Card>

        <Card id="privacy" title="Privacy" refs={refs}>
          <p className="pb-2 text-[13px] leading-5 text-ink-2">Only your city is ever shared, never exact coordinates.</p>
          <Row label="Let friends see my bird flying">
            <Switch on={draft.shareBird} onChange={(v) => set('shareBird', v)} label="Let friends see my bird flying" />
          </Row>
          <Row label="Show my stats to friends">
            <Switch on={draft.shareStats} onChange={(v) => set('shareStats', v)} label="Show my stats to friends" />
          </Row>
        </Card>

        <Card id="account" title="Account" refs={refs}>
          <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <img src="/assets/google.svg" alt="" className="size-5" />
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-ink">Connected Google account</span>
              <span className="block truncate text-[13px] text-ink-2">{user?.email}</span>
            </span>
          </div>
          <div className="flex flex-col gap-2 pt-3">
            {DEMO_MODE && (
            <button type="button" onClick={() => { loadDemoData(); flash('Demo data loaded.') }} className="rounded-full bg-white py-2.5 text-[14px] font-bold text-sage shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              Load demo data
            </button>
            )}
            <button type="button" onClick={signOut} className="rounded-full bg-line py-2.5 text-[14px] font-bold text-ink">
              Sign out
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} className="py-2.5 text-[14px] font-bold text-[#ba1a1a]">
              Delete my account
            </button>
          </div>
        </Card>

        <section aria-labelledby="about-h" className="px-1 text-[12px] leading-5 text-muted">
          <h2 id="about-h" className="font-semibold uppercase tracking-[0.6px]">
            About
          </h2>
          <p>Place data: OpenStreetMap, GeoNames. Map tiles: OpenFreeMap.</p>
        </section>
      </main>

      {(dirty || toast) && (
        <div className="sticky bottom-0 z-40 px-4 pb-4">
          {toast && !dirty ? (
            <p role="status" className="mx-auto w-fit rounded-full bg-ink px-4 py-2 text-[13px] text-white shadow-[0_8px_24px_rgba(62,58,54,0.2)]">
              {toast}
            </p>
          ) : (
            <div className="flex items-center justify-between rounded-full bg-white/95 p-2 pl-5 shadow-[0_8px_24px_-4px_rgba(62,58,54,0.15)] backdrop-blur-[12px]">
              <span className="text-[13px] font-bold text-ink">Unsaved changes</span>
              <span className="flex gap-2">
                <button type="button" onClick={cancel} className="rounded-full px-4 py-2 text-[13px] font-bold text-ink-2">
                  Cancel
                </button>
                <button type="button" onClick={save} className="rounded-full bg-[#d58767] px-5 py-2 text-[13px] font-bold text-white">
                  Save changes
                </button>
              </span>
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div role="dialog" aria-modal="true" aria-label="Delete account" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6">
          <div className="w-full max-w-[360px] rounded-2xl bg-white p-5 text-center shadow-[0_8px_24px_rgba(62,58,54,0.2)]">
            <h2 className="font-serif text-[20px] font-semibold text-ink">Delete your account?</h2>
            <p className="pt-1 text-[14px] text-ink-2">Your account, stamps, stories and letters will be removed, and letters still in the air are dropped. This can't be undone.</p>
            {deleteError && (
              <p role="alert" className="pt-3 text-[14px] font-semibold text-[#ba1a1a]">
                {deleteError}
              </p>
            )}
            <div className="flex gap-2 pt-4">
              <button type="button" disabled={deleting} onClick={() => (setConfirmDelete(false), setDeleteError(''))} className="flex-1 rounded-full bg-card-soft py-2.5 text-[14px] font-bold text-ink-2 disabled:opacity-60">
                Keep it
              </button>
              <button type="button" disabled={deleting} onClick={deleteAccount} className="flex-1 rounded-full bg-[#ba1a1a] py-2.5 text-[14px] font-bold text-white disabled:opacity-60">
                {deleting ? 'Deleting...' : deleteError ? 'Try again' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Frame>
  )
}

function Card({ id, title, children, refs }: { id: string; title: string; children: ReactNode; refs: React.MutableRefObject<Record<string, HTMLElement | null>> }) {
  return (
    <section ref={(el) => { refs.current[id] = el }} aria-labelledby={`${id}-h`} className="scroll-mt-28 rounded-[20px] bg-card p-4 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
      <h2 id={`${id}-h`} className="pb-3 font-serif text-[20px] font-semibold leading-7 text-ink">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span>
        <span className="block text-[14px] font-bold text-ink">{label}</span>
        {hint && <span className="block text-[12px] text-ink-2">{hint}</span>}
      </span>
      {children}
    </div>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors ${on ? 'justify-end bg-sage' : 'justify-start bg-outline'}`}>
      <span className="size-6 rounded-full bg-cream shadow-[0_1px_2px_rgba(0,0,0,0.05)]" />
    </button>
  )
}
