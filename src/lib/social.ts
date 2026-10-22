import { api, ApiError } from './api'
import { COGNITO_CONFIGURED } from './auth'
import { DEMO_MODE } from './demo'
import { send } from './outbox'
import { getState, setState, type Friend, type Letter } from './store'

/**
 * With Cognito configured, friends are real: the API owns requests and acceptance (/friends/*).
 * The directory below plays "other users" for offline demo mode only (DEMO_MODE, no Cognito).
 */
export type Person = { id: string; name: string; city: string; cc: string; lat: number; lng: number; district: string; code: string; photo?: string }

export const PEOPLE: Person[] = [
  { id: 'maya', name: 'Maya Lin', city: 'Kyoto', cc: 'JP', lat: 35.01, lng: 135.77, district: 'Tea District', code: 'MAYA2024', photo: '/assets/avatar-maya.jpg' },
  { id: 'julian', name: 'Julian Vance', city: 'Berlin', cc: 'DE', lat: 52.52, lng: 13.41, district: 'Studio', code: 'JULIAN42', photo: '/assets/avatar-julian.jpg' },
  { id: 'clara', name: 'Clara Rossi', city: 'Florence', cc: 'IT', lat: 43.77, lng: 11.26, district: 'Oltrarno', code: 'CLARA515', photo: '/assets/avatar-clara.jpg' },
  { id: 'kenji', name: 'Kenji Takahashi', city: 'Osaka', cc: 'JP', lat: 34.69, lng: 135.5, district: 'Dotonbori', code: 'KENJI777', photo: '/assets/avatar-kenji.jpg' },
  { id: 'elena', name: 'Elena Rostova', city: 'Prague', cc: 'CZ', lat: 50.08, lng: 14.44, district: 'Old Town', code: 'WING4421', photo: '/assets/avatar-elena.jpg' },
  { id: 'sora', name: 'Sora Arnason', city: 'Reykjavik', cc: 'IS', lat: 64.14, lng: -21.9, district: 'Harbor', code: 'SORA7788' },
  { id: 'amelie', name: 'Amélie Dubois', city: 'Lyon', cc: 'FR', lat: 45.76, lng: 4.84, district: 'Croix-Rousse', code: 'AMELIE31' },
  { id: 'priya', name: 'Priya Nair', city: 'Mumbai', cc: 'IN', lat: 19.08, lng: 72.88, district: 'Bandra', code: 'PRIYA909' },
  { id: 'lars', name: 'Lars Berg', city: 'Oslo', cc: 'NO', lat: 59.91, lng: 10.75, district: 'Grünerløkka', code: 'LARS2020' },
  { id: 'zoe', name: 'Zoe Mbeki', city: 'Cape Town', cc: 'ZA', lat: -33.92, lng: 18.42, district: 'Woodstock', code: 'ZOE55555' },
  { id: 'mateo', name: 'Mateo Silva', city: 'São Paulo', cc: 'BR', lat: -23.55, lng: -46.63, district: 'Vila Madalena', code: 'MATEO321' },
  { id: 'tomas', name: 'Tomás Rojas', city: 'Valparaíso', cc: 'CL', lat: -33.05, lng: -71.62, district: 'Cerro Alegre', code: 'TOMAS808' },
]

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

const AVATARS = ['#ffdbcd', '#cae7f8', '#c6ecd0', '#efe7e1']
export const avatarColor = (id: string) => AVATARS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length]

export const toFriend = (p: Person, status: Friend['status'], activity?: string): Friend => ({
  id: p.id,
  name: p.name,
  city: p.city,
  cc: p.cc,
  status,
  activity,
  photo: p.photo,
  lat: p.lat,
  lng: p.lng,
})

export function myInviteCode(): string {
  const email = getState().user?.email ?? 'guest'
  let h = 0
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h.toString(36).toUpperCase().padStart(8, 'A').slice(0, 8)
}

const norm = (c: string) => c.replace(/[^a-z0-9]/gi, '').toUpperCase()

export function findPersonByCode(code: string): Person | undefined {
  const n = norm(code)
  return DEMO_MODE && n ? PEOPLE.find((p) => p.code === n) : undefined
}

const REQUEST_ERRORS: Record<number, string> = {
  400: "That's your own code, or your profile isn't finished yet.",
  404: "That code doesn't match anyone. Check it and try again.",
  409: 'That code is shared by more than one person. Ask your friend to check it.',
}

/** Sends a request by invite code. Throws an Error with a message fit to show the user (a direct call, never queued). */
export async function requestFriendByCode(code: string): Promise<Friend> {
  let f: Friend
  try {
    f = await api<Friend>('/friends/request', { method: 'POST', body: JSON.stringify({ code }) })
  } catch (e) {
    if (e instanceof ApiError) throw new Error(REQUEST_ERRORS[e.status] ?? 'Something went wrong. Try again in a moment.')
    throw new Error("Can't reach the roost right now. Check your connection and try again.")
  }
  setState((st) => ({ friends: [...st.friends.filter((x) => x.id !== f.id), f] }))
  return f
}

/** Demo only: sends a request; the demo directory accepts it a moment later. */
export function requestFriend(p: Person) {
  const st = getState()
  if (st.friends.some((f) => f.id === p.id)) return
  setState({ friends: [...st.friends, toFriend(p, 'pending_out')] })
  window.setTimeout(() => acceptFriend(p.id), 2500)
}

// Local state changes first; the API write goes through the outbox (retried when offline; a no-op without Cognito).
export function acceptFriend(id: string) {
  setState({ friends: getState().friends.map((f) => (f.id === id ? { ...f, status: 'accepted' } : f)) })
  void send({ id: `friend-accept:${id}`, method: 'POST', path: `/friends/${id}/accept` })
}

export function declineFriend(id: string) {
  setState({ friends: getState().friends.filter((f) => f.id !== id) })
  void send({ id: `friend-decline:${id}`, method: 'POST', path: `/friends/${id}/decline` })
}

export function removeFriend(id: string) {
  setState({ friends: getState().friends.filter((f) => f.id !== id) })
  void send({ id: `friend-remove:${id}`, method: 'DELETE', path: `/friends/${id}` })
}

export function writeLetter(input: {
  toId: string
  text: string
  attachments?: Letter['attachments']
  status: Letter['status']
}): Letter {
  const st = getState()
  const letter: Letter = {
    id: crypto.randomUUID(),
    fromId: 'me',
    fromName: st.user?.name ?? 'Me',
    fromCity: st.homeCity?.name ?? '',
    cc: st.homeCity?.cc ?? '',
    toId: input.toId,
    text: input.text,
    attachments: input.attachments ?? [],
    status: input.status,
    dateMs: Date.now(),
  }
  setState({ letters: [letter, ...st.letters] })
  return letter
}

const REPLIES = [
  'Your bird landed on my windowsill here in {city} just as the light turned golden. I read your letter twice over breakfast. Write again soon!',
  'Greetings from {city}! {bird} was a little windswept but very proud. Sending warm wishes back with the same wings.',
  'What a lovely surprise. The whole street in {city} is quiet today, so it was the perfect moment to read your news. Safe flying, and come visit!',
  'Thank you for thinking of me. It rained all morning in {city}, and your letter was the brightest thing in my day. Reply is tucked under the wing.',
  'Your letter made my whole week. I walked to the {district} to read it slowly, with a coffee. More soon!',
  '{bird} arrived right on time, and the tea was still warm. I am sending a little something back with the same wings.',
]

/** The friend answers a delivered letter; the reply rides home on the returning bird. */
export function replyFrom(friend: Friend): Letter {
  return {
    id: crypto.randomUUID(),
    fromId: friend.id,
    fromName: friend.name,
    fromCity: friend.city,
    cc: friend.cc,
    toId: 'me',
    text: REPLIES[Math.floor(Math.random() * REPLIES.length)]
      .replace('{city}', friend.city)
      .replace('{district}', PEOPLE.find((p) => p.id === friend.id)?.district ?? 'park')
      .replace('{bird}', getState().bird?.name ?? 'Your bird'),
    attachments: [],
    status: 'CARRIED',
    dateMs: Date.now(),
  }
}

/** Demo only: pending requests left over from a previous visit resolve once the app reopens. Real requests wait for the other user. */
export function settleRequests() {
  if (COGNITO_CONFIGURED) return
  const st = getState()
  if (st.friends.some((f) => f.status === 'pending_out')) {
    setState({ friends: st.friends.map((f) => (f.status === 'pending_out' ? { ...f, status: 'accepted' as const } : f)) })
  }
}
