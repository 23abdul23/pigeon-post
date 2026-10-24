import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Flag from '../components/Flag'
import { AppLayout } from '../components/Layout'
import { KM_PER_FOCUS_MINUTE } from '../lib/geo'
import { useStore, type Letter } from '../lib/store'

type Box = 'all' | 'unopened' | 'sent' | 'keep'

const SEALS = [
  { bg: '#8e4d31', icon: '/assets/mb-seal-1.svg', w: 'size-[10.8px]' },
  { bg: '#446650', icon: '/assets/mb-seal-2.svg', w: 'h-[10.8px] w-[13px]' },
  { bg: '#d58767', icon: '/assets/mb-seal-3.svg', w: 'size-[11.9px]' },
]
const STAMPS = ['/assets/mb-stamp-1.svg', '/assets/mb-stamp-2.svg', '/assets/mb-stamp-3.svg']
const CARDS = ['bg-card-soft -rotate-1', 'bg-card rotate-1', 'bg-white', 'bg-card-soft rotate-1']

function when(ms: number) {
  const d = Date.now() - ms
  if (d < 86400000 && new Date(ms).getDate() === new Date().getDate()) return `Delivered ${new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  const days = Math.floor(d / 86400000)
  return days <= 1 ? 'Yesterday' : `${days} days ago`
}

export default function Mailbox() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const box = (params.get('box') as Box) ?? 'all'
  const letters = useStore((s) => s.letters)
  const friends = useStore((s) => s.friends)
  const bird = useStore((s) => s.bird)
  const trip = useStore((s) => s.trip)

  const received = letters.filter((l) => l.toId === 'me' && (l.status === 'DELIVERED' || l.status === 'OPENED'))
  const sent = letters.filter((l) => l.fromId === 'me')
  const unopened = received.filter((l) => l.status === 'DELIVERED')
  const keep = letters.filter((l) => l.saved)
  const inflight = sent.filter((l) => l.status === 'CARRIED')
  const coming = letters.filter((l) => l.toId === 'me' && l.status === 'CARRIED')

  const list: Letter[] = useMemo(() => {
    if (box === 'unopened') return unopened
    if (box === 'keep') return keep
    if (box === 'sent') return []
    return received
  }, [box, received, unopened, keep])

  const showSent = box === 'sent' || box === 'all'
  const senders = [...new Set(unopened.map((l) => l.fromName.split(' ')[0]))]
  const friendName = (id: string) => friends.find((f) => f.id === id)

  function open(l: Letter) {
    nav(`/mailbox/${l.id}`) // an unread letter plays the envelope opening on the letter screen itself
  }

  return (
    <AppLayout hand="Mailbox">
      <div className="flex flex-col gap-4 pb-2">
        <div className="relative flex items-start justify-between pt-1">
          <div>
            <h1 className="font-serif text-[24px] leading-8 tracking-[-0.6px] text-ink">Mailbox</h1>
          </div>
        </div>

        <section className="relative flex gap-4 overflow-hidden rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <img src="/assets/mb-postmark.svg" alt="" className="pointer-events-none absolute -bottom-6 -right-6 size-[140px] opacity-10" />
          <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-xl bg-line shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <img src="/assets/mailbox-photo.jpg" alt="" className="absolute h-full max-w-none object-cover" style={{ left: '-57%', width: '215%' }} />
            {unopened.length > 0 && <span className="absolute right-1 top-1 size-2.5 animate-pulse rounded-full bg-[#8e4d31]" />}
          </div>
          <div className="relative flex min-w-0 flex-1 flex-col justify-between py-0.5">
            <span className="mb-1 flex w-fit items-center gap-1 rounded-full bg-[#ffdbcd] px-2 py-0.5 text-[12px] font-bold tracking-[0.36px] text-[#360f00]">
              <img src="/assets/mb-mail-chip.svg" alt="" className="h-[10.5px] w-[11.7px]" />
              {unopened.length === 0 ? 'No unread letters' : `${unopened.length} unread letter${unopened.length > 1 ? 's' : ''}`}
            </span>
            <p className="text-[14px] leading-[19px] text-ink">
              {coming.length > 0 ? (
                <>
                  Your pigeon <b className="font-serif text-[15px] text-[#8e4d31]">{bird?.name ?? 'Pip'}</b> is gliding homeward with {coming.length} fresh despatch{coming.length > 1 ? 'es' : ''} from {[...new Set(coming.map((l) => l.fromCity))].join(' & ')}.
                </>
              ) : unopened.length > 0 ? (
                <>
                  Your pigeon <b className="font-serif text-[15px] text-[#8e4d31]">{bird?.name ?? 'Pip'}</b> brought {unopened.length === 1 ? 'a despatch' : 'fresh despatches'} from {senders.join(' & ')}.
                </>
              ) : (
                'Your mailbox is quiet. Fly to a friend and your bird will bring back their reply.'
              )}
            </p>
          </div>
        </section>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter letters">
          {(
            [
              ['all', `All (${received.length + sent.length})`],
              ['unopened', `Unopened (${unopened.length})`],
              ['sent', `Sent by me (${sent.length})`],
              ['keep', 'Keepsakes'],
            ] as [Box, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={box === k}
              onClick={() => setParams(k === 'all' ? {} : { box: k })}
              className={`flex shrink-0 items-center gap-1 rounded-full py-1.5 text-[12px] font-semibold tracking-[0.36px] ${
                box === k ? 'bg-[#7fa38a] px-4 text-[#183926] shadow-[0_1px_1px_rgba(0,0,0,0.05)]' : 'bg-card px-3.5 text-ink-2'
              }`}
            >
              {k === 'unopened' && box === k && <img src="/assets/mb-unopened.svg" alt="" className="size-[12.5px]" />}
              {label}
            </button>
          ))}
        </div>

        {inflight.length > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-[rgba(202,231,248,0.6)] p-2 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <span className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-sky">
                <img src="/assets/mb-flight.svg" alt="" className="size-[13.5px]" />
              </span>
              <span>
                <span className="block text-[13px] leading-[16px] text-[#4d6876]">
                  {inflight.length} letter{inflight.length > 1 ? 's' : ''} in flight
                </span>
                <span className="block text-[12px] leading-[15px] text-[#4d6876] opacity-80">Arriving in next focus session</span>
              </span>
            </span>
            <span className="px-1 font-hand text-[22px] font-bold leading-7 text-sky-ink">{trip ? `~${Math.max(1, Math.ceil((trip.routeKm - trip.progressKm) / KM_PER_FOCUS_MINUTE))} min` : ''}</span>
          </div>
        )}

        {list.length === 0 && !(showSent && sent.length > 0) && (
          <div className="rounded-2xl bg-card-soft p-8 text-center">
            <img src="/assets/mb-mail-chip.svg" alt="" className="mx-auto mb-2 h-5 w-6 opacity-50" />
            <p className="font-serif text-[18px] text-ink">{box === 'keep' ? 'No keepsakes yet' : 'No letters yet'}</p>
            <p className="pt-1 text-[14px] text-ink-2">{box === 'keep' ? 'Save a letter you love and it will wait here.' : 'Letters from friends will gather here.'}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {list.map((l, i) => {
            const read = l.status === 'OPENED'
            const seal = SEALS[i % 3]
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => open(l)}
                aria-label={`${read ? 'Read' : 'Unopened'} letter from ${l.fromName} in ${l.fromCity}`}
                className={`flex min-h-[172px] flex-col justify-between rounded-2xl p-3 text-left drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)] ${
                  read ? 'bg-[rgba(233,225,219,0.6)] opacity-85' : CARDS[i % CARDS.length]
                }`}
              >
                <span className="flex items-start justify-between pb-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px] ${read ? 'bg-line font-normal text-ink-2' : 'bg-sage text-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]'}`}>
                    {read ? 'Read' : 'New'}
                  </span>
                  <span className={`relative flex h-11 w-9 flex-col items-center justify-between overflow-hidden rounded-[2px] bg-white p-0.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] ${read ? 'opacity-70' : ''}`}>
                    <span className="flex h-7 w-full items-center justify-center rounded-[2px] bg-[rgba(198,236,208,0.3)]">
                      <img src={read ? '/assets/mb-stamp-read.svg' : STAMPS[i % 3]} alt="" className="h-4 w-4" />
                    </span>
                    <span className="font-mono text-[7px] tracking-[-0.35px] text-ink-2">{l.cc}·{(80 + ((i * 35 + l.cc.charCodeAt(0)) % 250)).toString()}</span>
                  </span>
                </span>
                <span className="block py-1">
                  <span className="block truncate font-serif text-[16px] leading-5 text-ink">{l.fromName}</span>
                  <span className="flex items-center gap-1 pt-0.5 text-[12px] leading-[18px] text-ink-2">
                    {l.fromCity}
                    <Flag cc={l.cc} className="w-4" />
                  </span>
                </span>
                <span className="flex items-center justify-between pt-5">
                  <span className="text-[11px] text-[rgba(66,72,67,0.8)]">{when(l.dateMs)}</span>
                  <span className="flex size-6 items-center justify-center rounded-full shadow-[0_1px_1px_rgba(0,0,0,0.05)]" style={{ background: read ? '#e9e1db' : seal.bg }}>
                    <img src={read ? '/assets/mb-seal-broken.svg' : seal.icon} alt="" className={read ? 'size-[10.8px]' : seal.w} />
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {showSent &&
          sent.map((l) => {
            const to = friendName(l.toId)
            const status =
              l.status === 'WAITING'
                ? 'Waiting for a bird to visit'
                : l.status === 'CARRIED'
                  ? `In flight${trip ? ` (${Math.max(0, Math.round(trip.routeKm - trip.progressKm)).toLocaleString('en-US')} km left)` : ''}`
                  : l.status === 'OPENED'
                    ? 'Opened'
                    : 'Delivered'
            return (
              <div key={l.id} className="flex items-center justify-between rounded-2xl bg-card p-3.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[rgba(202,231,248,0.5)]">
                    <img src="/assets/mb-emblem.svg" alt="" className="h-[16.7px] w-[11.7px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-serif text-[15px] leading-[22px] text-ink">
                      To: {to?.name ?? 'a friend'}
                      {to && <Flag cc={to.cc} className="w-4" />}
                    </p>
                    <p className="flex items-center gap-2 pt-0.5 text-[11px] font-bold text-sky-ink">
                      <span className="size-1.5 rounded-full bg-sky-ink" />
                      {status}
                    </p>
                  </div>
                </div>
                {l.status === 'WAITING' && to && (
                  <Link to={`/trip/new?friend=${to.id}`} aria-label={`Fly to ${to.name}`} className="flex size-8 items-center justify-center rounded-full bg-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                    <img src="/assets/fr-compass.svg" alt="" className="size-[15px]" />
                  </Link>
                )}
              </div>
            )
          })}

        <p className="pt-4 text-center font-hand text-[22px] font-medium leading-7 text-ink-2">Letters gather quietly like dried leaves. Take your time replying.</p>
      </div>
    </AppLayout>
  )
}
