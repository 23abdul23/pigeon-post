import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Flag from '../components/Flag'
import { AppLayout } from '../components/Layout'
import MiniMap from '../components/MiniMap'
import { acceptFriend, avatarColor, declineFriend, initials, removeFriend, settleRequests } from '../lib/social'
import { useStore, type Friend } from '../lib/store'
import { countryName } from '../lib/geo'

const fmtLeft = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000))
  return m >= 60 ? `~ ${Math.round(m / 60)}h remaining` : `~ ${m}m remaining`
}

export default function Friends() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const friends = useStore((s) => s.friends)
  const home = useStore((s) => s.homeCity)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const tab = params.get('tab') === 'requests' ? 'requests' : 'friends'

  useEffect(() => {
    settleRequests()
    const id = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(id)
  }, [])

  const accepted = friends.filter((f) => f.status === 'accepted')
  const incoming = friends.filter((f) => f.status === 'pending_in')
  const outgoing = friends.filter((f) => f.status === 'pending_out')
  const removed = friends.filter((f) => f.status === 'removed') // they deleted their account
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return n ? accepted.filter((f) => f.name.toLowerCase().includes(n) || f.city.toLowerCase().includes(n)) : accepted
  }, [accepted, q])
  const inbound = accepted.find((f) => f.flight && f.flight.endMs > now)

  return (
    <AppLayout hand="Friends">
      <div className="flex flex-col gap-3 pb-2">
        <div className="flex items-center justify-between pt-1">
          <div>
            <h1 className="font-serif text-[24px] leading-8 tracking-[-0.6px] text-ink">Friends</h1>
          </div>
          <Link to="/friends/add" className="flex items-center gap-1.5 rounded-full bg-[#8e4d31] px-4 py-2 text-[14px] font-bold tracking-[0.28px] text-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <img src="/assets/fr-add.svg" alt="" className="h-3 w-[16.5px]" />
            Add friend
          </Link>
        </div>

        <div className="relative">
          <img src="/assets/tc-search.svg" alt="" className="pointer-events-none absolute left-3.5 top-1/2 size-[15px] -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search friends by name or city..."
            aria-label="Search friends"
            className="w-full rounded-full bg-card-soft py-2.5 pl-10 pr-4 text-[14px] text-ink shadow-[inset_0_1px_3px_rgba(62,58,54,0.06)] outline-none placeholder:text-muted focus:ring-2 focus:ring-sage/40"
          />
        </div>

        <div className="flex items-center gap-1 rounded-full bg-card p-1 shadow-[0_1px_1px_rgba(0,0,0,0.05)]" role="tablist">
          <TabBtn on={tab === 'friends'} onClick={() => setParams({})} label="Friends" badge={String(accepted.length)} tone="sage" />
          <TabBtn on={tab === 'requests'} onClick={() => setParams({ tab: 'requests' })} label="Requests" badge={incoming.length ? String(incoming.length) : ''} tone="terracotta" />
        </div>

        {tab === 'friends' && (
          <>
            {inbound?.flight && <InFlight friend={inbound} now={now} homeName={home?.name ?? 'home'} />}

            {accepted.length === 0 && (
              <div className="rounded-2xl bg-card-soft p-8 text-center">
                <p className="font-serif text-[18px] text-ink">No friends yet</p>
                <p className="pt-1 text-[14px] text-ink-2">Invite someone to send letters.</p>
                <Link to="/friends/add" className="mt-4 inline-block rounded-full bg-[#8e4d31] px-5 py-2.5 text-[14px] font-bold text-white">
                  Add a friend
                </Link>
              </div>
            )}
            {accepted.length > 0 && shown.length === 0 && <p className="py-6 text-center text-[14px] text-ink-2">No friends match "{q}".</p>}

            <div className="flex flex-col gap-3">
              {shown.map((f, i) => (
                <article key={f.id} className="flex flex-col gap-3 rounded-2xl bg-card-soft p-3.5 shadow-[0_2px_8px_-2px_rgba(62,58,54,0.05)]">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar f={f} on={!!f.flight || i % 2 === 0} />
                      <div>
                        <h2 className="flex items-center gap-1.5 font-serif text-[16px] font-semibold leading-6 text-ink">
                          {f.name}
                          <Flag cc={f.cc} className="w-4" />
                        </h2>
                        <p className="text-[14px] leading-5 text-ink-2">
                          {f.city}, {countryName(f.cc)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpen(open === f.id ? null : f.id)}
                      aria-expanded={open === f.id}
                      aria-label={`View ${f.city} on map`}
                      className="flex size-9 items-center justify-center rounded-full bg-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]"
                    >
                      <img src="/assets/fr-compass.svg" alt="" className="size-[15px]" />
                    </button>
                  </div>

                  {open === f.id && (
                    <div className="overflow-hidden rounded-xl bg-line">
                      <MiniMap center={{ lat: f.lat, lng: f.lng }} zoom={9} className="h-32" />
                      <div className="flex items-center justify-between bg-line p-2.5">
                        <span className="text-[12px] font-semibold tracking-[0.36px] text-ink-2">{f.city}</span>
                        <button type="button" onClick={() => nav(`/trip/new?friend=${f.id}`)} className="rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-sage shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                          Fly there
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <Status f={f} now={now} />
                    <button
                      type="button"
                      onClick={() => nav(`/trip/new?friend=${f.id}&letter=1`)}
                      className={`flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[12px] font-semibold tracking-[0.36px] shadow-[0_1px_1px_rgba(0,0,0,0.05)] bg-[#8e4d31] text-white`}
                    >
                      <img src="/assets/fr-send-white.svg" alt="" className="h-2.5 w-3" />
                      Send letter
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {removed.map((f) => (
              <article key={f.id} className="flex items-center justify-between rounded-2xl bg-card-soft p-3.5 opacity-80 shadow-[0_2px_8px_-2px_rgba(62,58,54,0.05)]">
                <div className="flex items-center gap-3">
                  <Avatar f={f} />
                  <div>
                    <h2 className="font-serif text-[16px] font-semibold leading-6 text-ink">{f.name}</h2>
                    <p className="text-[14px] leading-5 text-ink-2">Friend removed: they closed their account</p>
                  </div>
                </div>
                <button type="button" onClick={() => removeFriend(f.id)} aria-label={`Dismiss ${f.name}`} className="rounded-full bg-line px-3 py-1.5 text-[12px] font-semibold text-ink-2">
                  Dismiss
                </button>
              </article>
            ))}

            {incoming.length > 0 && (
              <button type="button" onClick={() => setParams({ tab: 'requests' })} className="mt-1 flex items-center justify-between rounded-2xl bg-[#ffdbcd] p-3.5 text-left shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                <span className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-[#8e4d31] shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                    <img src="/assets/fr-envelope.svg" alt="" className="h-[15px] w-[16.7px]" />
                  </span>
                  <span>
                    <span className="block font-serif text-[14px] font-bold leading-5 text-[#360f00]">
                      {incoming.length} correspondent{incoming.length > 1 ? 's' : ''} waiting
                    </span>
                    <span className="block text-[12px] leading-[18px] text-[#71361c]">Letters from {incoming.map((f) => f.city).join(' & ')}</span>
                  </span>
                </span>
                <img src="/assets/fr-arrow.svg" alt="" className="size-[13.3px]" />
              </button>
            )}
            <p className="rotate-1 pt-2 text-center font-hand text-[22px] font-medium leading-7 text-[#8e4d31] opacity-75">~ every letter crosses winds and stars ~</p>
          </>
        )}

        {tab === 'requests' && (
          <div className="flex flex-col gap-3">
            {incoming.length === 0 && outgoing.length === 0 && <p className="rounded-2xl bg-card-soft p-8 text-center text-[14px] text-ink-2">No requests right now.</p>}
            {incoming.map((f) => (
              <article key={f.id} className="flex flex-col gap-3 rounded-2xl bg-card-soft p-3.5 shadow-[0_2px_8px_-2px_rgba(62,58,54,0.05)]">
                <div className="flex items-center gap-3">
                  <Avatar f={f} />
                  <div>
                    <h2 className="flex items-center gap-1.5 font-serif text-[16px] font-semibold leading-6 text-ink">
                      {f.name}
                      <Flag cc={f.cc} className="w-4" />
                    </h2>
                    <p className="text-[14px] leading-5 text-ink-2">
                      {f.city}, {countryName(f.cc)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => acceptFriend(f.id)} className="flex-1 rounded-full bg-[#8e4d31] py-2 text-[14px] font-bold text-white">
                    Accept
                  </button>
                  <button type="button" onClick={() => declineFriend(f.id)} className="flex-1 rounded-full bg-line py-2 text-[14px] font-bold text-ink-2">
                    Decline
                  </button>
                </div>
              </article>
            ))}
            {outgoing.map((f) => (
              <article key={f.id} className="flex items-center justify-between rounded-2xl bg-card-soft p-3.5 shadow-[0_2px_8px_-2px_rgba(62,58,54,0.05)]">
                <div className="flex items-center gap-3">
                  <Avatar f={f} />
                  <div>
                    <h2 className="font-serif text-[16px] font-semibold leading-6 text-ink">{f.name}</h2>
                    <p className="text-[14px] leading-5 text-ink-2">{f.city}</p>
                  </div>
                </div>
                <span className="rounded-full bg-line px-3 py-1 text-[12px] font-semibold text-ink-2">Waiting</span>
              </article>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function TabBtn({ on, onClick, label, badge, tone }: { on: boolean; onClick: () => void; label: string; badge: string; tone: 'sage' | 'terracotta' }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-[14px] font-bold tracking-[0.28px] ${on ? 'bg-white text-ink shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'text-ink-2'}`}
    >
      {label}
      {badge && (
        <span className={`rounded-full px-2 text-[11px] leading-5 ${tone === 'sage' ? 'bg-[rgba(68,102,80,0.1)] text-sage' : 'bg-[#8e4d31] px-1.5 text-[10px] text-white'}`}>{badge}</span>
      )}
    </button>
  )
}

function Avatar({ f, on }: { f: Friend; on?: boolean }) {
  return (
    <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full text-[16px] font-bold text-[#360f00]" style={{ background: f.photo ? '#efe7e1' : avatarColor(f.id) }}>
      {f.photo ? <img src={f.photo} alt="" className="absolute h-full w-[184%] max-w-none object-cover" style={{ left: '-42%' }} /> : initials(f.name)}
      {on !== undefined && <span className={`absolute bottom-0 right-0 size-3.5 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${on ? 'bg-sage' : 'bg-outline'}`} />}
    </span>
  )
}

function Status({ f, now }: { f: Friend; now: number }) {
  const flying = f.flight && f.flight.endMs > now
  const text = flying ? `Flying to you from ${f.flight!.fromCity}` : (f.activity ?? 'Resting at roost')
  const tone = flying || /flying/i.test(text) ? 'bg-sky text-[#4d6876]' : /completed/i.test(text) ? 'bg-[#c6ecd0] text-[#2c4e39]' : 'bg-[#efe7e1] text-ink-2'
  const icon = flying || /flying/i.test(text) ? '/assets/fr-st-flight.svg' : /completed/i.test(text) ? '/assets/fr-st-check.svg' : /resting at roost/i.test(text) ? '/assets/fr-st-moon.svg' : '/assets/fr-st-home.svg'
  return (
    <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${tone}`}>
      <img src={icon} alt="" className="size-[10.8px]" />
      {text}
    </span>
  )
}

function InFlight({ friend, now, homeName }: { friend: Friend; now: number; homeName: string }) {
  const fl = friend.flight!
  const pct = Math.min(99, Math.max(1, Math.round(((now - fl.startMs) / (fl.endMs - fl.startMs)) * 100)))
  return (
    <section className="relative flex flex-col gap-3 overflow-hidden rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]" aria-label={`${friend.name}'s bird is in the sky`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-serif text-[14px] font-semibold leading-5 text-ink">
          <img src="/assets/tc-nav.svg" alt="" className="size-[15px]" />
          {friend.name.split(' ')[0]}’s bird is in the sky
        </span>
        <span className="font-hand text-[22px] font-bold leading-7 tracking-[0.55px] text-[#8e4d31]">{fmtLeft(fl.endMs - now)}</span>
      </div>
      <div className="flex flex-col gap-2 rounded-xl bg-white/80 p-3 shadow-[0_1px_4px_rgba(62,58,54,0.04)] backdrop-blur-[2px]">
        <div className="flex items-center justify-between text-[12px] font-semibold tracking-[0.36px] text-ink-2">
          <span className="flex items-center gap-1">
            <img src="/assets/fr-origin.svg" alt="" className="size-[11.7px]" />
            {fl.fromCity}
          </span>
          <span className="flex items-center gap-1">
            {homeName}
            <img src="/assets/fr-dest.svg" alt="" className="h-[11.7px] w-[9.3px]" />
          </span>
        </div>
        <div className="relative flex h-8 items-center">
          <span className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-outline" />
          <span className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-sage" style={{ width: `${pct}%` }} />
          <span className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${pct}%` }}>
            <span className="flex size-6 -rotate-12 items-center justify-center rounded-full bg-[#8e4d31] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)]">
              <img src="/assets/fr-bird-marker.svg" alt="" className="h-[11.7px] w-2" />
            </span>
            <span className="text-[9px] font-bold text-ink-2">{pct}%</span>
          </span>
        </div>
        <div className="flex items-center justify-between pt-1 text-[11px]">
          <span className="italic text-ink-2">Crossing the skies at steady altitude</span>
          <span className="font-bold text-sage">Fair Winds</span>
        </div>
      </div>
    </section>
  )
}
