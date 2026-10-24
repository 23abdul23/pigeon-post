# Pigeon Post

A calm focus-timer web app. A 3D bird flies across a real map while you stay on the tab, lands somewhere, and tells you a short story about the place. Friends can send each other letters that the bird carries.

Built from the Figma file (18 mobile frames). On wide screens the app shows the mobile layout in a centered column.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests for the flight maths
npm run build    # production build in dist/
```

Click "Continue with Google" (it is a local stand-in), pick a home city and a bird, and fly. In **Settings > Account > Load demo data** you can fill the app with the sample friends, letters, stories and stamps from the design.

## Stack

Vite + React 19 + TypeScript + Tailwind 4, React Router, MapLibre GL (OpenFreeMap tiles), three.js (3D birds, glTF), `flag-icons`, `html-to-image` (share cards). No backend: data lives in `localStorage` behind `src/lib/store.ts`.

## How it works

- **Flight is clock based** (`src/lib/flight.ts`): position = start distance + elapsed minutes x 100 km, so a throttled tab cannot drift. Leaving the tab, reloading or closing it freezes the bird and lands it on return (Welcome Back).
- **Landing stories** (`src/lib/stories.ts`): nearest Wikipedia article within 10 km, else the nearest of 12k bundled cities, plus birds recorded nearby from GBIF. Never throws; falls back to a plain card.
- **Friends and letters** (`src/lib/social.ts`): a local directory plays the role of other users. A letter goes `WAITING -> CARRIED -> DELIVERED -> OPENED`. Flying to a friend delivers your letter, picks up their reply, and the return leg brings it home.
- **Birds** (`src/lib/birds.ts`, `src/lib/birdModel.ts`, `public/models/`): 7 flying low-poly glb models. Hawk (Sherkiz, CC BY, Poly Pizza) has a skeletal fly clip; Stork, Flamingo and Parrot (mirada, from the three.js examples) have morph-target flap clips, all played with an AnimationMixer. Gull, Seagull and Hummingbird (Poly by Google, CC BY 3.0) are static flying poses, so their wings are flapped by lifting vertices in proportion to distance from the body. The grid uses one shared renderer for still previews. **License risk:** the three.js example birds carry no explicit asset license; confirm or replace them before shipping commercially.
- **Routing** (`src/lib/landRoute.ts`): A* on a 1 degree land mask (Natural Earth 110m) where water costs 3x land, so flights follow coasts and land bridges and cross open water only when needed.
- **Wind and temperature** on the flight screen come from Open-Meteo (no key). Landing stories also use iNaturalist for birds seen nearby.
- **Demo mode**: the Settings sample-data button and the Add friend hint show in dev or when built with `VITE_DEMO=1`. Sample places are real Wikipedia summaries cached in `src/data/stories.json`.
- **Place search** is local (GeoNames cities, `src/data/cities.json`), no API key needed.

## Screens (routes)

`/signin`, `/onboarding/city`, `/onboarding/bird`, `/home`, `/fly/:tripId` (Focus, and Welcome Back after leaving the tab), `/landing/:storyId`, `/trip/new`, `/friends`, `/friends/add`, `/mailbox`, `/mailbox/:id`, `/passport`, `/passport/share`, `/journal`, `/journal/:id`, `/settings/:section`.

## Known gaps

- **Routing is a 1 degree grid**, so it is coarse near coasts, and trips under 300 km stay a straight line.
- **No AWS backend yet** (Cognito, API, DynamoDB, S3, Bedrock). The `src/lib` modules are the seams where it plugs in.
- **Settings** was built from the written spec, not the Figma frame (Figma's MCP call limit was reached before that frame could be read).
- Voice dictation uses the browser's speech API where available (Chrome, Edge).
- Sounds (coo, paper rustle) are synthesised with Web Audio; the flight ambience toggle has no audio yet.
