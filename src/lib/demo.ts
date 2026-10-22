import seeded from '../data/stories.json'
import { PEOPLE, toFriend } from './social'
import { getState, setState, type Letter, type SessionLog, type Story } from './store'

const DAY = 86400000

/** Demo helpers (sample data button, sample invite code) show in dev, or in a build made with VITE_DEMO=1. */
export const DEMO_MODE = import.meta.env.DEV || import.meta.env.VITE_DEMO === '1'

/** Fills the app with the sample content from the design so every screen can be explored offline. */
export function loadDemoData() {
  const now = Date.now()
  const p = (id: string) => PEOPLE.find((x) => x.id === id)!
  const me = getState()

  const friends = [
    { ...toFriend(p('maya'), 'accepted', 'Flying to Lisbon (Outbound)'), flight: { startMs: now - 3 * 3600000, endMs: now + 2 * 3600000, fromCity: 'Kyoto' } },
    toFriend(p('julian'), 'accepted', 'Resting at roost'),
    toFriend(p('clara'), 'accepted', 'Completed flight to Athens'),
    toFriend(p('kenji'), 'accepted', 'Bird resting'),
    { ...toFriend(p('priya'), 'accepted', 'Flying to Oslo (Outbound)'), flight: { startMs: now - 1 * 3600000, endMs: now + 4 * 3600000, fromCity: 'Mumbai' } },
    toFriend(p('lars'), 'accepted', 'Resting at roost'),
    toFriend(p('zoe'), 'accepted', 'Completed flight to Marrakesh'),
    toFriend(p('amelie'), 'pending_in'),
    toFriend(p('tomas'), 'pending_in'),
  ]

  const incoming = (id: string, name: string, city: string, cc: string, status: Letter['status'], ageDays: number, text: string, attachments: Letter['attachments'] = []): Letter => ({
    id: `demo-${id}`,
    fromId: id,
    fromName: name,
    fromCity: city,
    cc,
    toId: 'me',
    text,
    attachments,
    status,
    dateMs: now - ageDays * DAY,
  })

  const outgoing = (id: string, toId: string, status: Letter['status'], text: string, ageMs: number): Letter => ({
    id,
    fromId: 'me',
    fromName: me.user?.name ?? 'Me',
    fromCity: me.homeCity?.name ?? '',
    cc: me.homeCity?.cc ?? '',
    toId,
    text,
    attachments: [],
    status,
    dateMs: now - ageMs,
  })

  const letters: Letter[] = [
    incoming(
      'maya',
      'Maya Lin',
      'Kyoto',
      'JP',
      'DELIVERED',
      0.1,
      'Pip arrived just as the rain cleared over Arashiyama bamboo groves. The sound of water dripping from the cedar eaves made for a peaceful focus morning.\n\nI am attaching the quiet teahouse photos I took during my focus walk yesterday, as well as the reading notes for our design chapter. Let me know when your pigeon rests next!',
      [
        { name: 'Arashiyama at dawn.jpg', size: 1_200_000, type: 'image/jpeg', dataUrl: '/assets/ol-sample.jpg' },
        { name: 'Japanese_Aesthetics_Notes.pdf', size: 2_400_000, type: 'application/pdf' },
      ],
    ),
    incoming('julian', 'Julian Vance', 'Berlin', 'DE', 'DELIVERED', 1, 'The studio smells of fresh paint and strong coffee. I finished the poster series and thought of you the whole time. Come and see it when your bird next passes through.'),
    incoming('clara', 'Clara Rossi', 'Florence', 'IT', 'DELIVERED', 2, 'The olive harvest started this week and the whole hillside is golden. Sending you a little warmth from Oltrarno. Write back soon!'),
    incoming('sora', 'Sora Kim', 'Seoul', 'KR', 'OPENED', 3, 'Plum blossoms outside my window again. Hope your focus streak is going well!'),
    outgoing('demo-out-1', 'julian', 'CARRIED', 'Dear Julian, sending sketches your way.', 3600000),
    outgoing('demo-out-2', 'clara', 'WAITING', 'Dear Clara, thank you for the olive-branch postcard!', 7200000),
  ]

  const story = (
    id: string,
    place: string,
    region: string,
    country: string,
    cc: string,
    lens: Story['lens'],
    text: string,
    photo: string,
    ageDays: number,
    lat: number,
    lng: number,
    birds: string[],
    km: number,
  ): Story => ({ id: `demo-${id}`, place, region, country, cc, lens, text, photo, dateMs: now - ageDays * DAY, saved: id === 'lisbon', birds, km, lat, lng })

  const stories: Story[] = [
    story(
      'lisbon',
      'The Trams of Alfama',
      'Lisbon',
      'Portugal',
      'PT',
      'History',
      'The yellow tram climbs through morning sea fog as fado guitars echo from open shuttered windows. Down an alleyway no wider than outstretched arms, steam rises from bakeries releasing warm cinnamon and oven-fresh pastéis de nata into the coastal breeze.',
      '/assets/photo-lisbon.jpg',
      1,
      38.71,
      -9.13,
      ['Azure-winged Magpie', 'Sardinian Warbler', 'Common Swift'],
      5840,
    ),
    story(
      'kyoto',
      'Bamboo Wind at Arashiyama',
      'Kyoto',
      'Japan',
      'JP',
      'Nature',
      'Droplets fall through moss-covered cedar bark while carrier Pip rested on the temple eaves. The bamboo grove sways in a slow green rhythm, and every path smells faintly of rain and tea.',
      '/assets/photo-kyoto.jpg',
      5,
      35.01,
      135.67,
      ['Japanese White-eye', 'Brown-eared Bulbul'],
      5820,
    ),
    story(
      'alexandria',
      'The Golden Beacon of Pharos',
      'Alexandria',
      'Egypt',
      'EG',
      'Legend',
      'Ancient stone remnants whisper across the harbor where sea swallows gather at sunset. Sailors once steered by a fire that could be seen for miles over the water.',
      '/assets/photo-alexandria.jpg',
      12,
      31.2,
      29.92,
      ['Sand Martin', 'Pallid Swift'],
      4100,
    ),
  ]

  // Real places pre-cached from Wikipedia and iNaturalist (src/data/stories.json), one landing every ~3 days.
  const seededStories: Story[] = seeded.map((x, i) => ({
    id: `demo-${x.id}`,
    place: x.place,
    region: x.region,
    country: x.country,
    cc: x.cc,
    lens: x.lens as Story['lens'],
    text: x.text,
    photo: x.photo ?? undefined,
    sourceUrl: x.sourceUrl ?? undefined,
    dateMs: now - (14 + i * 3) * DAY,
    saved: i % 4 === 0,
    birds: x.birds,
    km: 1200 + ((i * 937) % 5200),
    lat: x.lat,
    lng: x.lng,
  }))
  stories.push(...seededStories)

  const stamps = [
    { cc: 'PT', country: 'Portugal', firstMs: now - 1 * DAY, visits: 3 },
    { cc: 'JP', country: 'Japan', firstMs: now - 5 * DAY, visits: 2 },
    { cc: 'DE', country: 'Germany', firstMs: now - 20 * DAY, visits: 1 },
    { cc: 'IT', country: 'Italy', firstMs: now - 35 * DAY, visits: 2 },
    { cc: 'IS', country: 'Iceland', firstMs: now - 60 * DAY, visits: 1 },
    { cc: 'EG', country: 'Egypt', firstMs: now - 12 * DAY, visits: 1 },
  ]
  for (const st of seededStories) if (!stamps.some((x) => x.cc === st.cc)) stamps.push({ cc: st.cc, country: st.country, firstMs: st.dateMs, visits: 1 })

  const sessions: SessionLog[] = [
    { id: 'd1', tripId: 'demo', startMs: now - 1 * DAY, endMs: now - 1 * DAY + 3600000, km: 5840, reason: 'completed' },
    { id: 'd2', tripId: 'demo', startMs: now - 5 * DAY, endMs: now - 5 * DAY + 2700000, km: 5820, reason: 'completed' },
    { id: 'd3', tripId: 'demo', startMs: now - 12 * DAY, endMs: now - 12 * DAY + 2400000, km: 4100, reason: 'completed' },
    { id: 'd4', tripId: 'demo', startMs: now - 20 * DAY, endMs: now - 20 * DAY + 1800000, km: 1800, reason: 'completed' },
    { id: 'd5', tripId: 'demo', startMs: now - 60 * DAY, endMs: now - 60 * DAY + 1500000, km: 840, reason: 'completed' },
  ]
  // 30 more days of history: a focus session most days (15 to 60 min, never random so the demo is repeatable).
  for (let d = 2; d < 40; d++) {
    if (d % 7 === 4 || d === 5 || d === 12 || d === 20) continue // skip a few days, leaving gaps in the streak
    const min = [25, 45, 15, 60, 30, 50, 20][d % 7]
    sessions.push({ id: `dh${d}`, tripId: 'demo', startMs: now - d * DAY, endMs: now - d * DAY + min * 60000, km: min * 100, reason: 'completed' })
  }

  setState({
    friends: [...me.friends.filter((f) => !friends.some((x) => x.id === f.id)), ...friends],
    letters: [...letters, ...me.letters.filter((l) => !l.id.startsWith('demo-'))],
    stories: [...stories, ...me.stories.filter((s) => !s.id.startsWith('demo-'))],
    stamps: [...stamps, ...me.stamps.filter((s) => !stamps.some((x) => x.cc === s.cc))],
    sessions: [...sessions, ...me.sessions.filter((s) => s.tripId !== 'demo')],
  })
}
