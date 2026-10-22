import { DEMO_MODE } from '../lib/demo'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Flag from '../components/Flag'
import { Frame } from '../components/Layout'
import { countryName, haversineKm } from '../lib/geo'
import { COGNITO_CONFIGURED } from '../lib/auth'
import { findPersonByCode, myInviteCode, requestFriend, requestFriendByCode, type Person } from '../lib/social'
import { useStore } from '../lib/store'

export default function AddFriend() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const inviteCode = useStore((s) => s.inviteCode)
  const home = useStore((s) => s.homeCity)
  const friends = useStore((s) => s.friends)
  const [tab, setTab] = useState<'invite' | 'code'>(params.get('code') ? 'code' : 'invite')
  const [code, setCode] = useState(params.get('code') ?? '')
  const [found, setFound] = useState<Person | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)

  // Real code from the server; the derived one only exists for offline demo mode.
  const mine = inviteCode ?? (COGNITO_CONFIGURED ? '' : myInviteCode())
  const stamp = mine || '--------'
  const link = mine ? `${window.location.host}/friends/add?code=${mine}` : ''
  const existing = found ? friends.find((f) => f.id === found.id) : undefined

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(`${window.location.protocol}//${link}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copy is not available here. Select the link and copy it by hand.')
    }
  }

  async function share() {
    if (!link) return
    const data = { title: 'Pigeon Post', text: `Join my roost on Pigeon Post. My code: ${mine}`, url: `${window.location.protocol}//${link}` }
    if (navigator.share) {
      try {
        await navigator.share(data)
      } catch {
        // user dismissed the share sheet
      }
    } else {
      void copy()
    }
  }

  // With the real API there is no directory to preview: the server resolves the code when the request is sent.
  async function sendByCode() {
    setError('')
    setSending(true)
    try {
      await requestFriendByCode(code)
      nav('/friends?tab=requests', { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setSending(false)
    }
  }

  function find() {
    if (COGNITO_CONFIGURED) return void sendByCode()
    setError('')
    const p = findPersonByCode(code)
    if (!p) {
      setFound(null)
      setError("That code doesn't match anyone. Check it and try again.")
      return
    }
    setFound(p)
  }

  function send() {
    if (!found) return
    requestFriend(found)
    nav('/friends?tab=requests', { replace: true })
  }

  const km = home && found ? haversineKm(home, { lat: found.lat, lng: found.lng }) : 0
  const sessions = Math.max(1, Math.ceil(Math.round(km / 100) / 25))

  return (
    <Frame>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-cream/85 px-4 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-[12px]">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => nav('/friends')} aria-label="Go back" className="flex size-11 items-center justify-center rounded-full">
            <img src="/assets/tc-back.svg" alt="" className="size-4" />
          </button>
          <h1 className="font-serif text-[20px] font-semibold leading-7 tracking-[-0.5px] text-ink">Add Friend</h1>
        </div>
        <Link to="/settings/profile" aria-label="Profile" className="flex size-11 items-center justify-center">
          <img src="/assets/profile.jpg" alt="" className="size-8 rounded-full shadow-[0_0_0_2px_rgba(127,163,138,0.4)]" />
        </Link>
      </header>

      <main className="flex-1 pb-8">
        <div className="px-5 pb-4 pt-2">
          <div className="flex rounded-full bg-[#efe7e1] p-1 shadow-[0_1px_1px_rgba(0,0,0,0.05)]" role="tablist">
            {(['invite', 'code'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[14px] font-bold tracking-[0.28px] ${tab === t ? 'bg-[#7fa38a] text-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'text-ink-2'}`}
              >
                <img src={t === 'invite' ? '/assets/af-tab-link.svg' : '/assets/af-tab-code.svg'} alt="" className={t === 'invite' ? 'h-[15px] w-[13.5px]' : 'h-[16.5px] w-3'} />
                {t === 'invite' ? 'Invite link' : 'Enter a code'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-6 px-5">
          {tab === 'invite' && (
            <section className="relative overflow-hidden rounded-xl bg-card-soft p-6 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <div className="pointer-events-none absolute -right-6 -top-6 flex size-[95px] rotate-12 items-center justify-center" aria-hidden>
                <div className="flex size-20 items-center justify-center rounded-full bg-[rgba(255,219,205,0.3)]">
                  <div className="flex size-14 items-center justify-center rounded-full bg-[rgba(213,135,103,0.2)]">
                    <img src="/assets/af-airmail.svg" alt="" className="h-[18px] w-[21px]" />
                  </div>
                </div>
              </div>
              <div className="pr-10">
                <p className="flex items-center gap-1.5 pb-1 text-[12px] font-semibold uppercase tracking-[0.6px] text-sage">
                  <img src="/assets/af-roost.svg" alt="" className="h-[13.5px] w-3" />
                  Roost network
                </p>
                <h2 className="font-serif text-[24px] leading-8 text-ink">Share your roost link</h2>
                <p className="pt-1 text-[14px] leading-[19px] text-ink-2">Friends can join with this link. You'll approve each request before letters exchange.</p>
              </div>
              <div className="mt-4 flex flex-col gap-1.5 rounded-xl bg-white p-4 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                <div className="flex h-7 items-center justify-between">
                  <span className="text-[12px] font-semibold tracking-[0.36px] text-muted">STAMP CODE</span>
                  <span className="-rotate-2 font-hand text-[22px] font-medium text-[#8e4d31]">valid indefinitely</span>
                </div>
                <p className="rounded-lg bg-card px-3 py-2.5 text-center font-serif text-[20px] font-semibold leading-7 tracking-[4.4px] text-ink shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]" aria-label={`Your stamp code ${stamp}`}>
                  {stamp.split('').join(' ')}
                </p>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                  <img src="/assets/af-link.svg" alt="" className="h-2 w-[16.7px]" />
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{link || 'Loading your link...'}</span>
                  {copied && <img src="/assets/af-check.svg" alt="Copied" className="size-4" />}
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => void copy()} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#d58767] py-3 text-[14px] font-bold tracking-[0.28px] text-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                    <img src="/assets/af-copy.svg" alt="" className="h-[15px] w-[12.8px]" />
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                  <button type="button" onClick={() => void share()} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-card py-3 text-[14px] font-bold tracking-[0.28px] text-ink shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                    <img src="/assets/af-share.svg" alt="" className="h-3 w-[14.3px]" />
                    Share via...
                  </button>
                </div>
              </div>
              <p className="mt-5 flex items-center justify-center gap-2 pt-2 text-center">
                <img src="/assets/af-tag.svg" alt="" className="size-[15px]" />
                <span className="rotate-1 font-hand text-[22px] font-medium leading-7 text-ink-2">"A handwritten letter travels at the speed of care."</span>
              </p>
              {error && (
                <p role="alert" className="pt-2 text-[13px] text-[#ba1a1a]">
                  {error}
                </p>
              )}
            </section>
          )}

          {tab === 'code' && (
            <section className="flex flex-col rounded-xl bg-card-soft p-6 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
              <p className="flex items-center gap-1.5 pb-1 text-[12px] font-semibold uppercase tracking-[0.6px] text-sage">
                <img src="/assets/af-inbound.svg" alt="" className="h-3 w-[15px]" />
                Inbound pigeon
              </p>
              <h2 className="pb-1 font-serif text-[24px] leading-8 text-ink">Enter Friend's Code</h2>
              <p className="pb-4 text-[14px] leading-5 text-ink-2">Have a friend's dispatch token or dispatch ticket code? Enter it below to locate their roost.</p>
              <div className="flex flex-col gap-2 pb-6">
                <div className="relative">
                  <img src="/assets/af-ticket.svg" alt="" className="pointer-events-none absolute left-3.5 top-3.5 h-[13.3px] w-[16.7px]" />
                  <input
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value)
                      setFound(null)
                      setError('')
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && find()}
                    placeholder="WING-4421"
                    aria-label="Friend's code"
                    className="w-full rounded-xl bg-white py-3 pl-11 pr-4 text-[16px] uppercase tracking-[0.8px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] outline-none placeholder:text-outline focus:ring-2 focus:ring-sage/40"
                  />
                </div>
                <button type="button" onClick={find} disabled={sending || (COGNITO_CONFIGURED && !code.trim())} className="flex items-center justify-center gap-2 rounded-full bg-[#7fa38a] py-3 text-[14px] font-bold tracking-[0.28px] text-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                  <img src="/assets/af-search.svg" alt="" className="size-[15px]" />
                  {COGNITO_CONFIGURED ? (sending ? 'Sending...' : 'Send roost request') : 'Find friend'}
                </button>
                {error && (
                  <p role="alert" className="text-[13px] text-[#ba1a1a]">
                    {error}
                  </p>
                )}
                {DEMO_MODE && !COGNITO_CONFIGURED && <p className="text-[12px] text-muted">Demo: try WING-4421, MAYA2024 or JULIAN42.</p>}
              </div>

              {found && (
                <div className="overflow-hidden rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                  <div className="-mx-4 -mt-4 mb-4 flex items-center justify-between bg-[rgba(244,236,230,0.5)] px-4 pb-3 pt-3.5">
                    <span className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.6px] text-sage">
                      <img src="/assets/af-verified.svg" alt="" className="size-[15px]" />
                      Roost located
                    </span>
                    <span className="font-hand text-[22px] font-medium leading-7 text-[#8e4d31]">Found safe &amp; sound</span>
                  </div>
                  <div className="flex items-start gap-4 pb-4">
                    <div className="relative shrink-0">
                      <span className="relative block size-14 overflow-hidden rounded-full bg-line shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                        {found.photo && <img src={found.photo} alt="" className="absolute h-[179%] w-full max-w-none object-cover" style={{ top: '-39.5%' }} />}
                      </span>
                      <span className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-card-soft">
                        <img src="/assets/af-badge.svg" alt="" className="h-[11.8px] w-[10.5px]" />
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-serif text-[20px] font-semibold leading-7 text-ink">{found.name}</h3>
                      <p className="flex items-center gap-1 pt-0.5 text-[14px] leading-5 text-ink-2">
                        <img src="/assets/af-pin.svg" alt="" className="h-[13.3px] w-[10.7px]" />
                        {found.city}, {countryName(found.cc)} <Flag cc={found.cc} className="w-4" />
                      </p>
                      <p className="flex items-center gap-1 pt-1 text-[12px] font-semibold tracking-[0.36px] text-muted">
                        <img src="/assets/af-calendar.svg" alt="" className="h-[9.3px] w-[11.4px]" />
                        Joined Pigeon Post 3 weeks ago
                      </p>
                    </div>
                  </div>
                  <div className="mb-4 flex items-center gap-2.5 rounded-lg bg-card-soft p-2.5">
                    <img src="/assets/af-path.svg" alt="" className="size-[16.7px]" />
                    <div>
                      <p className="text-[12px] font-semibold tracking-[0.36px] text-ink-2">Direct Flight Path</p>
                      <p className="text-[14px] leading-5 text-muted">
                        Estimated bird arrival: {sessions} session{sessions > 1 ? 's' : ''} delivery
                      </p>
                    </div>
                  </div>
                  {existing ? (
                    <p className="rounded-full bg-[#c6ecd0] py-3 text-center text-[14px] font-bold text-[#2c4e39]">
                      {existing.status === 'accepted' ? "You're already friends" : 'Request already sent'}
                    </p>
                  ) : (
                    <button type="button" onClick={send} className="flex w-full items-center justify-center gap-2 rounded-full bg-[#d58767] py-3 text-[14px] font-bold tracking-[0.28px] text-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                      <img src="/assets/af-send.svg" alt="" className="h-[14.2px] w-[16.7px]" />
                      Send roost request
                    </button>
                  )}
                  <p className="mt-3 flex items-start gap-1.5 px-1 text-[14px] leading-[17.5px] text-muted">
                    <img src="/assets/af-shield.svg" alt="" className="mt-0.5 h-[15px] w-[10.7px]" />
                    We only ever share your city, never exact coordinates.
                  </p>
                </div>
              )}
            </section>
          )}

          <div className="flex items-center justify-between rounded-xl bg-card p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-[37px] items-center justify-center rounded-full bg-sky">
                <img src="/assets/af-shield-blue.svg" alt="" className="h-[16.7px] w-[13.3px]" />
              </span>
              <div>
                <p className="text-[14px] font-bold tracking-[0.28px] text-ink">Quiet Correspondence</p>
                <p className="text-[14px] leading-5 text-muted">No push notifications during work sessions</p>
              </div>
            </div>
            <img src="/assets/af-chevron.svg" alt="" className="h-5 w-[11.8px]" />
          </div>
        </div>
      </main>
    </Frame>
  )
}
