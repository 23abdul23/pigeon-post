# Pigeon Post: Hackathon Demo Video Script

**Target length:** 3:00 (hard cap 3:30). **Format:** 16:9 screen recording of the app in a phone-width column, with motion-graphic cards in between.
**Two readers:** the **SAY** column is for you (read it aloud, about 140 words per minute). The **SHOW** column is the brief for Claude (what to record, build and animate).

## The idea in one line

> Focus is hard because nothing is at stake and nothing is rewarded. Pigeon Post makes your attention a **journey**: stay on the tab and a bird really flies across the world; leave and it lands where you left it.

## Use case: who truly needs to focus

The pain: the browser is where work happens, and also where every distraction lives. One tab switch is enough to lose the thread. Timers do not help, because a timer does not care whether you leave.

| Who | Moment | Why Pigeon Post fits |
| --- | --- | --- |
| Students and exam prep | A 25-minute study slot with a phone and 30 tabs nearby | The flight only moves while this tab is in front of you. Leaving ends the flight (after a 15 s grace), so the cost of drifting is visible, with no guilt streak |
| Developers, writers, remote workers | Deep work that needs unbroken blocks | Slots of 10, 15, 25 or 30 minutes map to one leg of a trip. A long task becomes a multi-stop journey |
| People who lose motivation to boring timers | "I know I should focus, I just don't" | The reward is curiosity: every landing gives a real story about a real place, plus a passport stamp |
| Long-distance friends and family | Wanting to feel close without a notification feed | Focus time is the postage. Your bird carries a letter to a friend and brings the reply back |

Keep the pitch about **honesty and calm**. Do not claim it cures distraction. Say it makes staying feel like going somewhere.

---

## Scene-by-scene script

### 0:00 – 0:20 | Scene 1: The problem

| SAY | SHOW (Claude: build this) |
| --- | --- |
| "You open a tab to work. Thirty seconds later you're in another one. Focus apps give you a countdown, and a countdown doesn't care if you leave." | **Motion graphic, 20 s.** Cream background (#f6f0ea style, match the app). A clean browser tab strip. A work tab is active; tabs pop in one by one (video, chat, news, shop) while a plain `25:00` timer keeps ticking and a small label "still counting..." fades in beside it. Hard cut to black on the beat "doesn't care". |

### 0:20 – 0:35 | Scene 2: The idea and the title

| SAY | SHOW |
| --- | --- |
| "So we flipped it. This is Pigeon Post: a calm focus timer where a 3D bird flies across a real map, but only while you stay." | **Title card + app open.** Logo and "Pigeon Post" fade in over a soft paper texture, then dissolve into the Sign In screen (`/signin`). Tagline under the title: *Stay on the tab. The bird keeps flying.* Add a subtle paper-plane arc that draws across the screen once. |

### 0:35 – 1:00 | Scene 3: Set-up in 20 seconds

| SAY | SHOW |
| --- | --- |
| "Sign in with Google, choose your hometown, and pick a bird. There are seven, each a real 3D model with animated wings." | **Screen recording**, `/signin` → `/onboarding/city` → `/onboarding/bird`. Type a small town in the city search (for example `Samobor`) and pick the result. On the bird grid, tap two or three birds so the 3D viewer shows the wing animation (hawk, stork, flamingo). Zoom 110% on the bird viewer. Keep each screen under 6 s. |

### 1:00 – 1:35 | Scene 4: The core loop (hero scene)

| SAY | SHOW |
| --- | --- |
| "Here's the Flight Desk. I pick a session length, 10 to 30 minutes, and a destination anywhere on Earth. The bird covers 100 kilometres for every minute I focus. Real route, real distance." | `/home`. Show the 10 / 15 / 25 / 30 chips, tap **25**. Search a far destination (for example Lisbon or Kyoto) and pick it. **Overlay callout:** `1 focus minute = 100 km` with a number counting up. Tap **Start flight**. |
| "Now I'm focusing. The map is live, the wind streaks match real wind from Open-Meteo, and there's soft birdsong and a breeze. Long trips split into stops, one per session." | `/fly/:tripId` (Focus screen). Hold on the flight map: dotted journey line, stop markers, wind streaks, stops rail, temperature chip. **Animation:** speed up the clock 30x for 5 s (a "time-lapse" badge in the corner) so the bird visibly travels along the route. |

### 1:35 – 2:00 | Scene 5: The stakes (the "focus" moment)

| SAY | SHOW |
| --- | --- |
| "And here's the part a timer can't do. If I switch tabs..." | Record this live. Switch to another tab for a beat. **Overlay:** a small "you left" tab icon, and the bird freezes with a subtle desaturate. |
| "...the bird stops. Come back within fifteen seconds and I can continue. Stay away longer and it simply lands where I left it. No streak to lose, no shame, just a visible, honest consequence." | Return to the tab: the **Welcome Back** prompt (`ResumePrompt`) appears. Show **Continue**. Then show a second take where the 15 s grace has passed and the flight lands early. **Overlay:** a 15 s ring that fills, labelled `grace period`. |

### 2:00 – 2:25 | Scene 6: The reward

| SAY | SHOW |
| --- | --- |
| "When the bird lands, I get a real story. It's the nearest Wikipedia article within ten kilometres, plus birds recently recorded nearby, polished by Claude on Amazon Bedrock so it reads warmly, using only the facts supplied." | `/landing/:storyId`. Show the story card: place, photo/text, nearby birds (GBIF / iNaturalist), and the **New stamp collected** animation (stamp thumps down with a postmark). **Overlay chips:** `Wikipedia`, `GBIF`, `iNaturalist`, `Claude on Bedrock`. |
| "Every country becomes a stamp in my passport, and every landing goes into my journal." | Quick cuts: `/passport` (stamp grid, flags), `/journal` (list), then `/passport/share` to produce a share card. 2 s each. |

### 2:25 – 2:45 | Scene 7: Letters between friends

| SAY | SHOW |
| --- | --- |
| "Focus is lonely, so the bird can carry letters. I write to a friend, my bird flies to them, delivers it, picks up their reply, and carries it home. Postage is attention." | `/trip/new` with the letter composer, then `/friends`, `/mailbox`. Animate a **letter status track** across the bottom: `WAITING → CARRIED → DELIVERED → OPENED`, lighting up each step. Finish on `/mailbox/:id/opening` (the envelope opening animation). |

### 2:45 – 3:00 | Scene 8: Built to be real, and close

| SAY | SHOW |
| --- | --- |
| "It's not a mock-up. Your flight is clock-based, so a throttled tab can't cheat it, and it follows you across devices: start on your laptop, take over on your phone. React and three.js on the front, a serverless AWS backend with Cognito, Lambda, DynamoDB and Bedrock behind it." | **Architecture animation (8 s):** left-to-right, boxes draw in: `React + three.js + MapLibre` → `CloudFront / S3` → `API Gateway` → `Lambda x15` → `DynamoDB` + `Cognito (Google)` + `Bedrock (Claude)`. Then a quick two-device split screen: laptop flight, phone shows "Flying on your other device", **Take over**. |
| "Pigeon Post. Don't just watch the clock. Go somewhere." | **End card:** bird flies across the title, text *Pigeon Post*, repo URL `github.com/23abdul23/pigeon-post`, team name. Hold 3 s. |

---

## Feature checklist (make sure every item appears on screen)

- [ ] Google sign-in, home city search and map picker
- [ ] 7 animated 3D birds
- [ ] 10 / 15 / 25 / 30 minute sessions, any destination, 100 km per focus minute
- [ ] Live flight map with land-aware routing (A* on a land mask), wind streaks, temperature, ambient sound
- [ ] Multi-stop journeys with stop cards and a stops rail
- [ ] Leave-the-tab behaviour: freeze, resume prompt, 15 s grace, early landing
- [ ] Landing stories (Wikipedia, GBIF, iNaturalist) and Claude polish via Bedrock
- [ ] Passport stamps, shareable stamp card, journal
- [ ] Friends, letters, the four-state delivery track, envelope opening
- [ ] Cross-device sync and take-over
- [ ] Privacy toggles in Settings (friends see my bird, show my stats)

## Notes for Claude (production)

1. **Style:** match the app: cream background, sage green accent (#7fa38a), serif headings, handwritten accent text. Motion: ease-out, 300 to 500 ms, nothing flashy. Calm is the brand.
2. **Recording:** run `npm run dev`, use the **Settings > Account > Load demo data** button to pre-fill friends, letters, stories and stamps, then record at 1080p. Reset with fresh state for Scenes 3 and 4.
3. **Build graphics as HTML/SVG** (Scenes 1, 2 and 8, plus callouts and overlays) and render them to video with Playwright screen capture. Keep them in a separate folder (for example `demo-video/`), not in `src/`.
4. **Timing tricks:** the real flight takes minutes. Record the start, the middle (use a short 10-minute slot or shorten the clock in dev) and the landing as separate clips, and join them with a "time-lapse" badge. Do not fake the leave-the-tab moment; it is the proof.
5. **Audio:** voice-over on top, the app's birdsong at about -30 dB under it, a soft coo on landing, paper rustle on the letter opening. No music with vocals.
6. **Captions:** burn in English captions. Many judges watch muted.

## If you only have 90 seconds

Keep Scene 1 (10 s), Scene 4 (25 s), Scene 5 (25 s), Scene 6 (15 s) and the close (15 s). Drop Scenes 3, 7 and the architecture shot. The leave-the-tab moment is the one thing that must survive any cut.

## Facts to double check before you record

- The README still says "no backend", but the repo now has a full AWS stack (`template.yaml`, `api/`, 15 Lambda functions), so say "serverless AWS backend" only if your deployed site is live. If not, show it as the architecture and say "built for".
- Bedrock story polish is capped at 80 words and 30 calls per user per day. Falls back to plain facts if Bedrock is unavailable.
- Birds: 3 of the 7 models come from the three.js examples with no explicit license. Fine for a hackathon demo; credit them on the end card ("Bird models: Poly Pizza, Poly by Google, three.js examples").
