// Shared by the SPA and the API (type-only; no runtime code, no DOM).

export type City = { name: string; country: string; cc: string; lat: number; lng: number }
export type Bird = { species: string; name: string }
/** A searchable or tappable place; `id` is namespaced by source (`photon:<osm_type><osm_id>`, `om:<geonameid>`, or the bundled `CC-name-lat`). */
export type Place = { id: string; name: string; region?: string; country: string; cc: string; lat: number; lng: number; kind?: 'locality' | 'poi' | 'region' }

export type Trip = {
  id: string
  dest: Place
  routeKm: number
  /** [lat, lng] points from home to the destination */
  route: [number, number][]
  progressKm: number
  status: 'OUTBOUND' | 'DELIVERED' | 'RETURNING' | 'PAUSED' | 'DONE'
  legs: number
  friendId?: string
  letterIds: string[]
  /** home city when the trip was created (older trips lack it; the client falls back to the current home) */
  origin?: City
}

/** The flight in progress, owned by one device (`PUT /flight`); `heartbeatMs` is server time; `legs` is the trip's legs at start (required on PUT; may be missing on rows written before it existed). */
export type ActiveFlight = { tripId: string; startMs: number; durationMin: number; baseKm: number; deviceId: string; leftAtMs?: number; heartbeatMs: number; legs?: number }

export type Story = {
  id: string
  place: string
  region?: string
  country: string
  cc: string
  lens: 'Legend' | 'Food' | 'Hidden spot' | 'Nature' | 'History'
  text: string
  photo?: string
  dateMs: number
  saved: boolean
  birds: string[]
  sourceUrl?: string
  km: number
  lat: number
  lng: number
}

export type Letter = {
  id: string
  fromId: string
  fromName: string
  fromCity: string
  cc: string
  toId: string
  text: string
  /** `key` is the S3 object (downloaded via a presigned URL); dataUrl is kept only for small local images (offline demo) */
  attachments: { name: string; size: number; type?: string; dataUrl?: string; key?: string }[]
  status: 'WAITING' | 'CARRIED' | 'DELIVERED' | 'OPENED'
  saved?: boolean
  dateMs: number
}

export type Friend = {
  id: string
  name: string
  city: string
  cc: string
  /** 'removed': they deleted their account (DELETE /me); shown until dismissed */
  status: 'accepted' | 'pending_in' | 'pending_out' | 'removed'
  activity?: string
  photo?: string
  /** simulated friend flight toward the user's home */
  flight?: { startMs: number; endMs: number; fromCity: string }
  lat: number
  lng: number
}

export type Stamp = { cc: string; country: string; firstMs: number; visits: number }

export type SessionLog = { id: string; tripId: string; startMs: number; endMs: number; km: number; reason: 'completed' | 'left' | 'ended' }

export type Settings = {
  bio: string
  volume: number
  coo: boolean
  rustle: boolean
  ambience: boolean
  notifyLetter: boolean
  notifyBird: boolean
  notifyFriend: boolean
  channel: 'email' | 'browser'
  shareBird: boolean
  shareStats: boolean
}

/** Body of `PUT /me` (fields left out are kept). */
export type Profile = { name: string; homeCity: City; bird: Bird; settings: Settings }
/** A stored profile; onboarding saves city before bird, so fields can be missing. */
export type ServerProfile = Partial<Profile> & { inviteCode: string }
/** `GET /state` (API contract). A `Trip` here omits `route`; the client recomputes it. */
export type ServerState = {
  profile: ServerProfile | null
  trip: Omit<Trip, 'route'> | null
  stories: Story[]
  letters: Letter[]
  friends: Friend[]
  stamps: Stamp[]
  sessions: SessionLog[]
  flight: ActiveFlight | null
  /** the server's Date.now(), for the client's clock offset */
  serverTime: number
}
/** `POST /trips/{id}/sessions` (API contract). */
export type SessionResult = { trip: Omit<Trip, 'route'>; stamp?: Stamp; story: Story; delivered: Letter[]; pickedUp: Letter[] }
