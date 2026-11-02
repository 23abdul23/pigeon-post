# Pigeon Post: Android App for the Play Store

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase by phase. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the existing Pigeon Post web app as an installable Android app on Google Play, reusing the React code and the AWS backend, with the focus-flight working correctly with the screen off and with the app in the background.

**Decision: wrap the web app with Capacitor.** Do not rewrite in React Native, and do not use a bare TWA.

| Option | Reuse | Verdict |
|---|---|---|
| **Capacitor** (WebView + native plugins) | ~95% of `src/` | **Chosen.** MapLibre GL JS, three.js and html-to-image keep working. Native plugins cover what the WebView lacks. iOS comes almost free later. |
| TWA / Bubblewrap (Chrome in a wrapper) | 100% | Fastest, but cannot run a foreground service, cannot do native auth, and Play reviewers can reject thin web wrappers. Fine only as a throwaway first alpha. |
| React Native rewrite | ~30% (logic in `src/lib`) | Throws away ~9k lines of working UI plus the 3D bird and map. Only worth it if WebView performance proves unacceptable (see risk R1). |

---

## 1. What the codebase looks like today

- 100% web: Vite + React 19 + Tailwind 4, React Router (`BrowserRouter`), MapLibre GL, three.js, `oidc-client-ts`.
- Backend already exists and is serverless (`template.yaml`, `api/`): Cognito (Google IdP), HTTP API, DynamoDB, S3, Bedrock, SES. Offline outbox and sync are built (`src/lib/outbox.ts`, `sync.ts`, `reconcile.ts`).
- The core mechanic is **browser-tab based**: leaving the tab freezes the flight, screen lock keeps it flying through a silent-audio hack (`keepAlive.ts`, `presence.ts`, `wakeLock.ts`). Desktop uses Document Picture-in-Picture (`pip.ts`).
- There is no PWA manifest, no service worker, and no `android/` project. Tests exist for the logic (vitest, ~35 files web, 13 api).

## 2. Gaps that block or endanger a Play Store release

Severity: **B** = blocks release, **H** = high risk of rejection or bad reviews, **M** = should fix, **L** = nice to have.

### Platform and auth
| # | Sev | Gap | Where | Fix |
|---|---|---|---|---|
| G1 | B | **Google blocks OAuth inside embedded WebViews** (`disallowed_useragent`). The current flow is `signinRedirect()` to Cognito Hosted UI then Google, inside the page. | `src/lib/auth.ts` | Open the Hosted UI in a Custom Tab (`@capacitor/browser`), return via an Android App Link / custom scheme (`com.pigeonpost.app:/auth/callback`), then call `signinCallback` with the URL. Add that scheme to Cognito `CallbackURLs`/`LogoutURLs` in `template.yaml`. Alternative: native Google sign-in (Credential Manager) plus Cognito federation. |
| G2 | B | Cognito/CORS allow only the CloudFront and localhost origins. A Capacitor WebView origin is `https://localhost` (or `capacitor://localhost`). | `template.yaml` (AllowedOrigins, CallbackURLs) | Set `server.androidScheme: 'https'` and add that origin to CORS. |
| G3 | H | Tokens and the whole app state live in `localStorage`. Android can evict WebView storage under pressure and tokens are readable by any injected script. | `store.ts`, `auth.ts` (`WebStorageStateStore`) | Move the token store and state to `@capacitor/preferences` (or SQLite) and the refresh token to Android Keystore via a secure-storage plugin. Keep a storage adapter so the web build is unchanged. |

### The core mechanic
| # | Sev | Gap | Fix |
|---|---|---|---|
| G4 | B | **Screen-off flight relies on a hack.** A looping near-silent audio file holds the tab alive (`keepAlive.ts`). On Android 14+ an app doing this in the background is killed or throttled, and Play policy treats fake media playback as abuse. | Replace with a real **foreground service** (type `specialUse` or `dataSync`, with a persistent "Your bird is flying to Lisbon" notification and an End flight action). Keep `computeProgress` clock logic untouched: it is already clock based, so the service only needs to keep the process alive and post checkpoint notifications. |
| G5 | H | "Leaving the tab ends the flight" maps badly to phones: notifications, calls, and the app switcher all background the app. | Define the rule explicitly for mobile: lock screen and notification shade keep flying; switching to another app freezes after the 2.5 s window (`presence.ts` already models this). Use `App.addListener('appStateChange')` plus a `screenOn/off` signal from a small native plugin to distinguish lock from switch. **Decided:** switching to another app freezes the flight; the screen sleeping (a single tap wakes it) keeps it flying with the app still open. |
| G6 | H | Checkpoint alerts use the web `Notification` API (`checkpointAlert.ts`). | Use `@capacitor/local-notifications` with a notification channel, and request `POST_NOTIFICATIONS` (Android 13+) with a rationale screen. Schedule checkpoint notifications ahead of time from the route, so they fire even if the process dies. |
| G7 | M | Desktop-only code paths (`pip.ts`, `FlightPopup.tsx`, the centered-column layout) must be dead on Android. | `popupSupported()` already returns false on mobile UA; verify the Capacitor UA is covered by `isMobileDevice()`. |

### Performance and size
| # | Sev | Gap | Fix |
|---|---|---|---|
| G8 | H | `src/assets` is **46 MB**: `Coo_1.wav` is 26 MB and `web_bird_bg.png` is 17 MB. Both land in the bundle. A 26 MB coo sound is a bug, and the AAB base limit is 200 MB but install size drives uninstalls. | Re-encode coos to ~30 KB `.ogg`/`.m4a`, convert background art to WebP/AVIF at device resolution (<300 KB), drop unused `web_*` art from the mobile build. Target an initial AAB under 25 MB. |
| G9 | H | MapLibre + three.js (animated GLB) in a WebView will be heavy on budget phones, and `FlightMap`/`WindStreaks` animate continuously. | Profile on a low-end device (Moto G class, 3 GB RAM). Add a "reduced effects" mode: cap devicePixelRatio, pause the 3D render when the screen is off, lower the animation framerate to 30, lazy-load three.js. Gate the decision to rewrite on measured results (R1). |
| G10 | M | Single big JS chunk, map worker copied by a custom plugin. | Route-level code splitting (`React.lazy`) for Focus, Passport, ShareStamps. Verify the worker path works under `https://localhost`. |
| G11 | M | Google Fonts are loaded from the network in `index.html`; a first launch offline falls back to system fonts. | Self-host Fraunces, Nunito Sans, Caveat via `@fontsource`. |
| G12 | M | Map tiles need the network (OpenFreeMap); there is no offline basemap. | Acceptable at launch; document that flights need a connection for tiles but the clock keeps running. |

### Native UX
| # | Sev | Gap | Fix |
|---|---|---|---|
| G13 | H | No safe-area handling for notches and gesture bars; only `dvh` is used. The app is built as a "centered column" for desktop. | Add `viewport-fit=cover`, `env(safe-area-inset-*)` padding in `Layout`/`BottomNav`, and `@capacitor/status-bar` + `@capacitor/splash-screen` config. Remove the centered-column wrapper for the native build. |
| G14 | H | Android hardware **Back button** is not handled; it would exit the app mid-flight. `Flow.md` rule 3/8 requires special behaviour. | `App.addListener('backButton')` mapped to router history, with the active-flight guard and a confirm dialog. |
| G15 | H | **Voice dictation** (`TripComposer.tsx`) uses `webkitSpeechRecognition`, which is not available in Android WebView. | Use `@capacitor-community/speech-recognition`, or hide the mic button when unsupported. |
| G16 | M | Sharing uses `html-to-image` then download/clipboard (`ShareStamps`, `JournalDetail`). | `@capacitor/share` + `@capacitor/filesystem` to share the PNG to the system sheet. Android `navigator.share` with files is unreliable in WebView. |
| G17 | M | Keyboard overlays inputs in the composer. | `@capacitor/keyboard` with `resize: 'body'`. |
| G18 | M | Haptics are absent; they sell the "bird arrived" moment. | `@capacitor/haptics` on landing, envelope open. |
| G19 | L | No adaptive icon, themed monochrome icon, or splash. `logo.png` is a 300 KB PNG. | Generate with `@capacitor/assets`; supply an adaptive icon (foreground/background) and Android 13 monochrome layer. |
| G20 | L | Accessibility is unaudited (TalkBack labels, contrast, 48 dp targets, reduced motion). | Audit with Accessibility Scanner; honour `prefers-reduced-motion` (map, wind, envelope). |

### Backend, data and compliance
| # | Sev | Gap | Fix |
|---|---|---|---|
| G21 | B | **Privacy policy and Data safety form** are required. The app handles email, name, photo, location-like data (home city, routes), and user-written letters. | Publish a privacy policy URL (host on the existing CloudFront domain). Fill Data safety: email, name, user content, app activity. State encryption in transit; no location permission is requested (city picker only). |
| G22 | B | **Account deletion must be available in-app and via a web URL** (Play policy). `DELETE /me` exists (`api/src/handlers/account.ts`). | Verify the Settings > Account button calls it, and add a public web page `/delete-account` for the Play listing field. |
| G23 | B | **User-generated content policy:** friends send each other free-text letters and attachments. Play requires in-app **report and block** plus content moderation. I found no block/report in `Friends.tsx` or `OpenedLetter.tsx`. | Add Block and Report on friends and letters, a `POST /reports` endpoint (DynamoDB record plus SES mail to a moderator address), and a Terms/EULA acceptance at sign-up. Optionally scan text with Bedrock (already provisioned) and attachments for size/type. |
| G24 | H | **Third-party API terms.** Open-Meteo's free tier is for **non-commercial** use only; GBIF/iNaturalist/Wikipedia/OpenFreeMap/Photon need attribution and polite use (User-Agent, caching). The README flags the three.js example birds as having **no explicit licence**. Hawk, Gull etc. are CC BY and need on-screen credits. | Move Open-Meteo to a paid key (proxied through the API), add an About > Credits screen (CC BY credits, OSM/OpenFreeMap, Natural Earth, GeoNames, Wikipedia), replace or license the Stork/Flamingo/Parrot models. Keep `SKETCHFAB_MODELS.md` current. |
| G25 | H | The API is called directly from clients with per-IP risk and no abuse control visible; mobile will increase traffic. | Add WAF rate limiting or API Gateway throttling per user, and request size limits (check `clamp.ts` covers letters/attachments). |
| G26 | M | **Push notifications for friends' letters** are absent: `notify.ts` sends only email (SES). Letters arriving is the social loop. | Add FCM: register token on sign-in (`POST /devices`), Lambda sends via FCM HTTP v1 when a letter is delivered. Use `@capacitor/push-notifications`. |
| G27 | M | `.env.production` has `REPLACE_ME` placeholders; native builds bake env at build time. | Add `.env.android`, injected from CI secrets (non-secret IDs only). |
| G28 | M | Minimum supported API and 16 KB page-size requirement (apps targeting Android 15+ must support 16 KB pages from Nov 2025). | Use current Capacitor (supports it), target the API level Play requires at submission time (verify: it moves every August), `minSdk 24`. |

### Process
| # | Sev | Gap | Fix |
|---|---|---|---|
| G29 | H | No Android CI, signing, or release flow. `deploy.yml` only deploys the web. | Add a GitHub Actions job: build web, `npx cap sync`, `./gradlew bundleRelease`, sign with an upload key from secrets, upload to the Play internal track (via `r0adkll/upload-google-play` or fastlane supply). |
| G30 | H | **New personal developer accounts must run a closed test with 12+ testers for 14 days** before production access. Organization accounts are exempt. | Register as an organization if possible, otherwise start recruiting 12 testers now. This sets the earliest launch date. |
| G31 | M | Only logic is unit tested (vitest, node env); UI and native paths have no tests. | Add Playwright smoke tests of the built web (sign-in stubbed, fly, land) and a manual Android device matrix checklist. |
| G32 | M | Crash and analytics visibility. | Firebase Crashlytics (or Sentry) and a minimal privacy-respecting event log; declare it in the Data safety form. |

---

## 3. Phased plan

Each phase ends with something runnable. Verify at every phase with `npm test`, `npx tsc -b`, `npx oxlint`, and `npm --prefix api test`.

### Phase 0: Decisions and accounts (1-2 days, no code)
- [x] Backgrounding rule decided (see section 6): app switch freezes, screen sleep keeps flying.
- [ ] Create the Play Console account (organization if possible, G30). Pay the one-time fee. Pick the application ID, e.g. `app.pigeonpost`.
- [ ] Create a Firebase project (FCM, Crashlytics); download `google-services.json`.
- [ ] Generate the upload keystore; store it and passwords in a password manager and as GitHub secrets. Enrol in Play App Signing.

### Phase 1: Capacitor shell that boots (2-3 days)
Files: `package.json`, new `capacitor.config.ts`, new `android/`, `vite.config.ts`.
- [ ] `npm i @capacitor/core @capacitor/android @capacitor/app @capacitor/status-bar @capacitor/splash-screen @capacitor/keyboard` and `-D @capacitor/cli @capacitor/assets`.
- [ ] `capacitor.config.ts`: `appId`, `appName: 'Pigeon Post'`, `webDir: 'dist'`, `server.androidScheme: 'https'`.
- [ ] `npx cap add android`; `npm run build && npx cap sync`; run on an emulator.
- [ ] Confirm the map worker (`assets/maplibre-gl-worker.mjs`) loads and the 3D bird renders.
- [ ] Add `src/lib/platform.ts` exporting `isNative` (`Capacitor.isNativePlatform()`) so every later change is behind one switch and the web build is untouched.
- [ ] Commit `android/` (exclude build outputs in `.gitignore`).

### Phase 2: Auth that Google will accept (3-4 days) fixes G1, G2, G3
Files: `src/lib/auth.ts`, `src/screens/SignIn.tsx`, `src/screens/AuthCallback.tsx`, `template.yaml`, `AndroidManifest.xml`.
- [ ] Write a failing test in `test/auth.test.ts` for a `completeSignInFromUrl(url)` helper, then implement it.
- [ ] On native, `signIn` opens `signinRedirect`'s URL with `Browser.open`; an `appUrlOpen` listener closes the browser and calls `signinCallback(url)`.
- [ ] Register the scheme/App Link in the manifest, add to Cognito `CallbackURLs`/`LogoutURLs`, and add the WebView origin to API CORS. Deploy the stack.
- [ ] Replace `localStorage` in `WebStorageStateStore` with a Preferences-backed adapter on native (G3).
- [ ] Manually test: fresh install, sign in, kill app, reopen (stays signed in), sign out, token refresh after a day.

### Phase 3: Flight that survives the screen off (1 week) fixes G4, G5, G6
Files: `src/lib/keepAlive.ts`, `presence.ts`, `wakeLock.ts`, `checkpointAlert.ts`, `Focus.tsx`, new `android/.../FlightService.kt`, new Capacitor plugin `FlightPlugin`.
- [ ] Native plugin `FlightPlugin` with `start({destination, endsAt})`, `update`, `stop`, and events `screenOff`, `screenOn`, `endRequested` (from the notification action).
- [ ] Android foreground service with a persistent notification and End action; declare `FOREGROUND_SERVICE` and the type permission in the manifest; request `POST_NOTIFICATIONS`.
- [ ] Create `src/lib/flightHost.ts` with the same surface as `keepAlive.ts` (`ensureKeepAlive`, `releaseKeepAlive`, `isKeepAliveActive`) so `Focus.tsx` changes minimally. Web build keeps the audio implementation; native uses the plugin.
- [ ] Feed `presence.ts` with the native lock signal so a lock is `locked` and an app switch is `left` (existing state machine; add test cases to `test/presence.test.ts`).
- [ ] Schedule checkpoint local notifications at flight start from the computed route and cancel them on end.
- [ ] Device test matrix: Pixel (stock), Samsung (One UI battery optimisation), Xiaomi (aggressive kill). Document the "battery optimisation" prompt for OEMs that kill services.

### Phase 4: Native feel (4-5 days) fixes G13-G18, G7, G11
- [ ] Safe areas, status bar style, splash, hardware Back handler with the flight guard.
- [ ] Self-host fonts; remove the centered-column wrapper in the native build.
- [ ] Share sheet for stamps and letters; speech recognition plugin or hidden mic; keyboard resize; haptics on landing and envelope open.
- [ ] Adaptive icon, monochrome icon, splash via `@capacitor/assets`.

### Phase 5: Slim and speed up (3-4 days) fixes G8-G10, G9
- [ ] Re-encode `Coo_1.wav` (26 MB) and `Coo_2.wav`; convert `web_bird_bg*.png`; delete unused assets; measure the AAB.
- [ ] Code-split heavy routes; lazy-load three.js and MapLibre.
- [ ] Add reduced-effects mode and `prefers-reduced-motion`; profile on a low-end device and record frame rate and battery drain over a 25-minute flight. **If the 25-minute flight drains more than ~6% battery or drops below ~24 fps on a budget phone, reopen the React Native question (R1).**

### Phase 6: Trust, safety and compliance (1 week) fixes G21-G25
Files: `api/src/handlers/` (new `reports.ts`, `blocks.ts`), `template.yaml`, `src/screens/Friends.tsx`, `OpenedLetter.tsx`, `Settings.tsx`, new `Credits.tsx`, new static `privacy.html`, `terms.html`, `delete-account.html`.
- [ ] Write failing API tests first (`api/test/reports.test.ts`, `blocks.test.ts`), then implement block, unblock, and report endpoints; blocked users cannot send letters or friend requests.
- [ ] Add Block/Report to friend rows and opened letters; add Terms acceptance to onboarding.
- [ ] Credits screen, licence audit of all models and assets, replace the three.js example birds if no licence is confirmed.
- [ ] Open-Meteo commercial key via a server proxy; add User-Agent and caching headers for Wikipedia, GBIF, iNaturalist.
- [ ] Publish privacy policy, terms and account-deletion pages; confirm `DELETE /me` end-to-end from Settings.
- [ ] API throttling and request size limits.

### Phase 7: Push notifications for letters (3-4 days) fixes G26
- [ ] `@capacitor/push-notifications`, `POST /devices` to store the FCM token in DynamoDB, a Lambda branch in `api/src/lib/notify.ts` to send via FCM HTTP v1 on `DELIVERED`.
- [ ] Settings > Notifications toggles map to the existing `settings.notifyBird` plus a new `notifyLetters`.

### Phase 8: Release engineering and store listing (3-4 days) fixes G27-G32
- [ ] `.env.android` from CI; Android job in `.github/workflows/` building a signed AAB and uploading to the **internal** track.
- [ ] Store listing: title, short and full description, 512x512 icon, 1024x500 feature graphic, 4-8 phone screenshots (the existing `frames/` are a good start; re-capture from the real app), category (Productivity or Lifestyle), content rating questionnaire, target audience (13+ because of messaging), Data safety form.
- [ ] Crashlytics wired up.
- [ ] Pre-launch report in Play Console reviewed and fixed.

### Phase 9: Testing tracks and launch (2+ weeks, mostly waiting)
- [ ] Internal testing (you and a few people), then **closed testing with 12+ testers for 14 consecutive days** (if a personal account), collect feedback.
- [ ] Fix issues, then request production access; start with a staged rollout (10% then 50% then 100%).
- [ ] Monitor Android vitals (ANR, crash rate, battery wake locks) for two weeks.

**Rough total: 5-6 weeks of engineering plus the 14-day closed test** (the test can overlap Phases 7-8 if the account is created in Phase 0).

---

## 4. Risks

- **R1: WebView performance and battery.** The mitigation is a measured go/no-go at Phase 5, not a guess. Fallback is to render the map in a native view (MapLibre Native) and keep the rest in the WebView.
- **R2: OEM background killing** (Xiaomi, Huawei, Samsung) can stop the foreground service. Mitigate with a battery-optimisation prompt and clock-based progress (a killed process just lands the bird on return, the existing "Welcome back" flow).
- **R3: Play review** of the foreground service type, UGC moderation, and the "special use" justification. Prepare a short video showing the user-visible foreground notification and the report/block flow.
- **R4: Asset licences** (README already flags the example birds). Resolve before the closed test, since the listing is public once in production.
- **R5: Cost.** Bedrock, SES and DynamoDB scale with users; add budget alerts and per-user throttles before launch.

## 5. Ideas to make the app better (after the gaps)

Retention and product
- **Streaks and weekly goals** on the Passport (stamps already exist): "5 flights this week" with a widget on the home screen.
- **Android home-screen widget and lock-screen live progress** (Android 16 live updates / ongoing notification with progress bar) showing the bird's remaining time. Natural fit for a focus timer.
- **Focus-mode integration:** optionally turn on Do Not Disturb during a flight (`ACCESS_NOTIFICATION_POLICY`), and show a "distracting apps" summary through Digital Wellbeing, only with explicit consent.
- **Flights with friends:** a shared flight where two friends fly the same route and both must stay focused ("co-flying").
- **Richer letters:** photo and voice-note attachments (S3 already provisioned), stamps chosen by country, and an optional delay equal to the actual flight time (the core charm).
- **Seasonal and themed birds and stamps**, birds unlocked by distance or country count instead of a free choice.
- **Statistics** (focus minutes by day, longest flight, countries) and an optional export.

Quality and trust
- **Offline basemap:** cache tiles for the route (MapLibre offline) so flights work with no signal.
- **Better routing:** README admits a 1° land mask and straight lines under 300 km; move to a 0.25° mask or great-circle with waypoint smoothing.
- **Localisation:** externalise strings (i18n), start with Spanish, Hindi, Portuguese, French. Stories are English-only Wikipedia today; use the user's Wikipedia language.
- **Accessibility:** TalkBack labels on map/HUD, text scaling, a low-motion mode, and a text description of flight progress.
- **Tablet and foldable layouts**, and landscape support for the focus screen.
- **Wear OS or notification-only mode** is a stretch goal.

Engineering
- **Compress the 3D birds** with Draco/Meshopt, KTX2 textures) to cut load time and memory.
- **Error and offline UX:** a single global "you're offline" bar and retry queue indicator (the outbox exists but has little UI).
- **End-to-end tests** (Playwright for web, Maestro for Android) running in CI before every release.
- **Observability:** CloudWatch dashboards for API latency and error rate, Crashlytics for the client.
- **iOS** via the same Capacitor project once Android is stable (needs Apple developer account, Sign in with Apple because Google sign-in is offered, and a different background story: iOS has no equivalent foreground service, so flights would rely on the clock and local notifications).

## 6. Decisions and remaining questions

**Decided**
1. **Backgrounding:** switching to another app **freezes** the flight (Welcome back on return). If the app is still the foreground app and the screen goes to sleep, the flight **continues**, and one tap wakes it. This is the existing `presence.ts` model (`locked` vs `left`). Phase 3 must therefore detect "screen off while our app is foreground" natively (`ACTION_SCREEN_OFF` receiver in the foreground service) and treat everything else that hides the app (home, recents, another app, incoming call UI) as leaving. Test cases to add in `test/presence.test.ts`: screen-off then screen-on resumes with no freeze; home button freezes; screen-off after another app is in front stays frozen.
2. **Monetisation: none.** No Play Billing. Data safety form declares no purchases; the listing is free with no ads, which also keeps the privacy policy simple.
3. **Audience 13+.** Target-audience question is answered 13+ (not a Families app). Messaging stays, so the report/block/moderation work in Phase 6 is mandatory, and the Terms must state the 13+ minimum age with a sign-up age confirmation.

**Still open**
1. **Account type.** Personal (needs the 12-tester, 14-day closed test) or organization (exempt, requires a D-U-N-S number)?
2. **Package name and branding.** Final application ID (it cannot change after publish) and whether "Pigeon Post" is free to use as a Play title.
3. **Region and languages** at launch.
