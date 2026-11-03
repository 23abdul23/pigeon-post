# Pigeon Post

A calm focus-timer app for web and Android. A 3D bird flies across a real map while you stay on the app, lands somewhere, and tells you a short story about the place. Friends can send each other letters that the bird carries.

Built from the Figma file (18 mobile frames). On wide screens the web app shows the mobile layout in a centered column.

## Set up locally

There are three ways to run the project. Start with the first; you do not need AWS or Android tooling for it.

### Prerequisites

| Tool | Needed for | Notes |
| --- | --- | --- |
| Node.js 20 or newer and npm | everything | CI uses Node 20; Node 22 also works |
| Git | everything | |
| JDK 21 and Android Studio (with an Android SDK, API 24 or newer) | the Android app only | Capacitor 8 needs JDK 21 |
| AWS CLI, AWS SAM CLI, an AWS account | deploying the backend only | not needed to run or test locally |

### 1. Web app, offline (no backend)

```bash
git clone https://github.com/23abdul23/pigeon-post.git
cd pigeon-post
npm install
npm run dev      # http://localhost:5173
```

With no environment variables the app runs against a local stand-in: "Continue with Google" signs you in as a mock user, and everything is stored in the browser's `localStorage` (`src/lib/store.ts`). Pick a home city and a bird, then fly. In **Settings > Account > Load demo data** you can fill the app with sample friends, letters, stories and stamps (the button shows in dev, or in a build made with `VITE_DEMO=1`).

Place search, landing stories (Wikipedia, GBIF, iNaturalist), map tiles (OpenFreeMap) and weather (Open-Meteo) need an internet connection but no API key.

Useful commands:

```bash
npm test             # web unit tests (vitest, about 460 tests)
npx tsc -b           # type-check
npm run lint         # oxlint (one known error remains in src/screens/HomeCity.tsx)
npm run build        # production build in dist/
npm run preview      # serve dist/ locally (npx vite preview --port 4173)
```

### 2. Web app against a real backend (optional)

The backend (Cognito sign-in, HTTP API, DynamoDB, S3) is defined in `template.yaml` and `api/`. To use one from your local dev server, deploy the stack once (see "Deploy the backend" below), then create `.env.local` in the repo root (it is git-ignored) with the stack outputs:

```bash
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_COGNITO_DOMAIN=https://your-domain.auth.us-east-1.amazoncognito.com
VITE_API_URL=https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com
```

Restart `npm run dev`. When all four are set the app signs in through Cognito (Google) instead of the mock user, and it syncs through the API. `http://localhost:5173/auth/callback` is already an allowed Cognito callback. `.env.production` holds placeholders only (`REPLACE_ME`); never commit real secrets, and never put a secret in a `VITE_` variable (they end up in the browser bundle).

Backend tests need no AWS account (the AWS SDK is mocked):

```bash
npm --prefix api ci
npm --prefix api test         # about 180 tests
npm --prefix api run typecheck
```

### 3. Android app (Capacitor)

The Android app wraps the same web build in a WebView (app id `app.pigeonpost`). You need JDK 21 and Android Studio with an SDK installed; Android Studio creates `android/local.properties` (git-ignored) with your SDK path when you open the project.

```bash
npm install
npm run android:sync     # builds the web app and copies it into android/ (npm run build && cap sync android)
npm run android:open     # opens the android/ project in Android Studio; press Run on an emulator or a device
```

Command-line alternative once the SDK is set up:

```bash
npm run android:sync
cd android && ./gradlew assembleDebug     # APK in android/app/build/outputs/apk/debug/
```

Things to know:

- Run `npm run android:sync` again after every web change or after adding a Capacitor plugin; the native project only contains the last synced build.
- Native sign-in opens Google in a Custom Tab and returns through the `app.pigeonpost://auth/callback` deep link, so it needs a deployed backend. `npm run android:sync` makes a production build, which reads `.env.production` (placeholders only: `REPLACE_ME`). Put the real four values in `.env.production.local` (git-ignored) before you sync; they override the placeholders. Without a real backend, sign-in in the Android app will not work; use the browser build for offline work.
- Push notifications are switched off (`VITE_PUSH_ENABLED=false`). Do not set it to `true` until a Firebase `android/app/google-services.json` (never commit it) is in place; without it the push plugin can crash the app after sign-in.
- The foreground service, Back button, share sheet and checkpoint notifications only run in the Android app, not in the browser. Test them on a device (API 24 to 35+).
- Release builds, signing and the Play Store upload are described in `docs/android-release.md`.

### Deploy the backend (optional, needs AWS)

```bash
sam validate --lint                         # check template.yaml
npm --prefix api ci
sam build --config-env ci
sam deploy --guided                         # first time; set GoogleClientId and the other parameters
```

Parameters (Google OAuth client, optional SES sender, optional Open-Meteo key, optional FCM secret) are documented at the top of `template.yaml`. `npm run deploy` wraps the same steps in PowerShell (`deploy.ps1`; pushes to `main` also deploy through GitHub Actions, `.github/workflows/deploy.yml`, so merging to `main` changes production).

### Troubleshooting

- **Blank map:** the MapLibre worker is copied by a custom Vite plugin; a stale `dist/` can miss it. Run `npm run build` again, or use `npm run dev`.
- **Sign-in goes to a strange Cognito address after `npm run build` / `npm run preview`:** a production build reads the `REPLACE_ME` placeholders in `.env.production`. Put real values in `.env.production.local`, or use `npm run dev` for offline work.
- **`gradlew` fails with "invalid source release: 21":** your JDK is older than 21; install JDK 21 and point `JAVA_HOME` at it.
- **Android build cannot find the SDK:** open the project once in Android Studio, or create `android/local.properties` with `sdk.dir=/path/to/Android/Sdk`.
- **Web changes do not appear in the Android app:** run `npm run android:sync` again.

## Stack

Vite + React 19 + TypeScript + Tailwind 4, React Router, MapLibre GL (OpenFreeMap tiles), three.js (3D birds, glTF), `flag-icons`, `html-to-image` (share cards). Android: Capacitor 8 (`android/`, native foreground service in Java). Backend: AWS SAM (`template.yaml`, Lambda handlers in `api/`), Cognito + Google sign-in, DynamoDB, S3, SES, Bedrock. Offline, data lives in `localStorage` behind `src/lib/store.ts` and syncs through an outbox when a backend is configured.

## How it works

- **Flight is clock based** (`src/lib/flight.ts`): position = start distance + elapsed minutes x 100 km, so a throttled tab cannot drift. Leaving the tab, reloading or closing it freezes the bird and lands it on return (Welcome Back).
- **Landing stories** (`src/lib/stories.ts`): nearest Wikipedia article within 10 km, else the nearest of 12k bundled cities, plus birds recorded nearby from GBIF. Never throws; falls back to a plain card.
- **Friends and letters** (`src/lib/social.ts`): a local directory plays the role of other users. A letter goes `WAITING -> CARRIED -> DELIVERED -> OPENED`. Flying to a friend delivers your letter, picks up their reply, and the return leg brings it home.
- **Birds** (`src/lib/birds.ts`, `src/lib/birdModel.ts`, `public/models/`): 7 flying low-poly glb models. Hawk (Sherkiz, CC BY, Poly Pizza) has a skeletal fly clip; Stork, Flamingo and Parrot (mirada, from the three.js examples) have morph-target flap clips, all played with an AnimationMixer. Gull, Seagull and Hummingbird (Poly by Google, CC BY 3.0) are static flying poses, so their wings are flapped by lifting vertices in proportion to distance from the body. The grid uses one shared renderer for still previews. **License risk:** the three.js example birds carry no explicit asset license; confirm or replace them before shipping commercially.
- **Routing** (`src/lib/landRoute.ts`): A* on a 1 degree land mask (Natural Earth 110m) where water costs 3x land, so flights follow coasts and land bridges and cross open water only when needed.
- **Wind and temperature** on the flight screen come from Open-Meteo: through the API (`GET /weather`) when a backend is configured, directly (no key, non-commercial tier) in offline dev. Landing stories also use iNaturalist for birds seen nearby.
- **Demo mode**: the Settings sample-data button and the Add friend hint show in dev or when built with `VITE_DEMO=1`. Sample places are real Wikipedia summaries cached in `src/data/stories.json`.
- **Place search** is local (GeoNames cities, `src/data/cities.json`), no API key needed.

## Documentation

- `docs/Flow.md`: every route, redirect and state machine.
- `docs/android-release.md`: Android signing, CI, Play Store tracks and the pre-release checklist.
- `docs/2026-11-02-android-playstore-app.md` and `docs/superpowers/plans/`: the Android plan and its task list.
- `docs/demo-script.md`: the hackathon demo script.

## Screens (routes)

`/signin`, `/onboarding/city`, `/onboarding/bird`, `/home`, `/fly/:tripId` (Focus, and Welcome Back after leaving the tab), `/landing/:storyId`, `/trip/new`, `/friends`, `/friends/add`, `/mailbox`, `/mailbox/:id`, `/passport`, `/passport/share`, `/journal`, `/journal/:id`, `/settings/:section`.

## Known gaps

- **Routing is a 1 degree grid**, so it is coarse near coasts, and trips under 300 km stay a straight line.
- **Android release is not finished:** the Java service and plugin have never been compiled in CI, push notifications are off, and several launch items are human decisions (licences, legal review, Play Console forms). See `docs/android-release.md`.
- **Settings** was built from the written spec, not the Figma frame (Figma's MCP call limit was reached before that frame could be read).
- Voice dictation uses the browser's speech API where available (Chrome, Edge).
- Sounds (coo, paper rustle) are synthesised with Web Audio; the flight ambience toggle has no audio yet.
