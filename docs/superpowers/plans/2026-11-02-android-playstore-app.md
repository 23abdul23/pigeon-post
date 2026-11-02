# Pigeon Post Android App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Pigeon Post as an Android app on Google Play (`app.pigeonpost`) by wrapping the existing React app in Capacitor, with native sign-in, a foreground-service flight, native notifications, and the Play-required safety features.

**Architecture:** The web app stays the single UI. `isNativeApp()` (`src/lib/platform.ts`, done in Phase 1) is the only switch: every native behaviour sits behind a small module under `src/lib/` that takes its native dependency as a parameter, so vitest (node environment, no jsdom) tests the logic with fakes and the web build is unchanged. Kotlin code lives in `android/app/src/main/java/app/pigeonpost/`.

**Tech Stack:** React 19, TypeScript, Vite, vitest (node env), Capacitor 8 (`@capacitor/core android app browser preferences local-notifications push-notifications share filesystem haptics status-bar keyboard`), oidc-client-ts 3.5, AWS SAM (`template.yaml`), Lambda handlers in `api/` (vitest + `aws-sdk-client-mock`), Kotlin.

**Spec:** `docs/2026-11-02-android-playstore-app.md` (gaps G1-G32, decisions in its section 6). Phase 1 (Capacitor shell, `isNativeApp`) is already committed; this plan covers Phases 2-8.

## Global Constraints

- Application ID `app.pigeonpost`; `minSdk 24`; WebView origin `https://localhost` (`server.androidScheme: 'https'`).
- Native OAuth redirect URIs: callback `app.pigeonpost://auth/callback`, sign-out `app.pigeonpost://signin`.
- Backgrounding rule: switching to another app **freezes** the flight; the screen sleeping while the app is still in front **keeps flying** (a tap wakes it). Progress stays clock based (`src/lib/flight.ts` is not changed).
- Audience 13+, worldwide, English only, no monetisation: no Play Billing, no ads. New user-facing strings go in `src/lib/strings.ts` (Task 13 creates it); never inline new copy elsewhere.
- Web build behaviour must not change: every existing test keeps passing, and any native code path is guarded by `isNativeApp()` or a dependency parameter.
- Verification commands, from the repo root: `npx vitest run`, `npx tsc -b`, `npx oxlint`, and for the API `npm --prefix api test`. Baseline before Task 1: 276 web tests pass, `tsc` clean, one pre-existing `oxlint` error in `src/screens/HomeCity.tsx:140` (not ours; do not fix inside these tasks).
- No secrets in the repo. Firebase `google-services.json` and signing keys come from CI secrets.
- Commit messages end with the two attribution lines given in the session's system reminder.

## Review Focus

- Native sign-in callback arrives twice, or after the user cancelled the Custom Tab: no crash, no double code exchange, user lands on `/signin` (Task 2).
- Storage unavailable or `Preferences` throws on read: sign-in state reads as signed out, not a white screen (Task 3).
- Screen turns off, then the user switches to another app before turning it on again: the flight must end up frozen, not running unattended (Task 5).
- A checkpoint notification scheduled for a flight that was later ended or frozen must be cancelled, never fire (Task 8).
- Hardware Back during an active flight or an open dialog never exits the app silently (Task 9).
- A blocked user's pending letters and friend requests are rejected server-side, not just hidden in the UI (Task 12).

---

## File Structure

- Create `src/lib/authUrls.ts`, `src/lib/nativeAuth.ts`, `src/lib/prefsStorage.ts`: native OAuth plumbing and token storage.
- Create `src/lib/nativeScreen.ts`, `src/lib/flightPlugin.ts`, `src/lib/flightHost.ts`: screen-state source, plugin bridge, and the keep-alive facade `Focus.tsx` calls.
- Create `src/lib/checkpointPlan.ts`, `src/lib/nativeChrome.ts`, `src/lib/share.ts`, `src/lib/strings.ts`.
- Create `android/app/src/main/java/app/pigeonpost/FlightService.kt`, `FlightPlugin.kt`; modify `MainActivity.java`/`.kt` and `AndroidManifest.xml`.
- Create `api/src/handlers/blocks.ts`, `reports.ts`, `weather.ts`, `devices.ts` with matching `api/test/*.test.ts`; modify `template.yaml`.
- Create `src/screens/Credits.tsx`, `public/privacy.html`, `public/terms.html`, `public/delete-account.html`.
- Create `.github/workflows/android.yml`.
- Modify `src/lib/auth.ts`, `presence.ts` (no change expected, see Task 5), `checkpointAlert.ts`, `src/screens/Focus.tsx`, `Friends.tsx`, `OpenedLetter.tsx`, `ShareStamps.tsx`, `JournalDetail.tsx`, `TripComposer.tsx`, `Settings.tsx`, `SignIn.tsx`, `src/lib/weather.ts`, `src/App.tsx`, `src/main.tsx`.

---

### Task 1: Auth URL helpers

**Files:**
- Create: `src/lib/authUrls.ts`
- Test: `test/authUrls.test.ts`

**Interfaces:**
- Produces:
  - `export const NATIVE_SCHEME = 'app.pigeonpost'`
  - `export function callbackUri(native: boolean, origin: string): string` returns `app.pigeonpost://auth/callback` when `native`, else `${origin}/auth/callback`.
  - `export function signOutUri(native: boolean, origin: string): string` returns `app.pigeonpost://signin` when `native`, else `${origin}/signin`.
  - `export function isAuthCallbackUrl(url: string): boolean` true only for URLs starting `app.pigeonpost://auth/callback` that carry a `code` or `error` query parameter.

- [ ] **Step 1: Write the failing tests** in `test/authUrls.test.ts`: `callbackUri_native_uses_custom_scheme`, `callbackUri_web_uses_origin`, `signOutUri_native_and_web`, `isAuthCallbackUrl_true_for_code`, `isAuthCallbackUrl_true_for_error`, `isAuthCallbackUrl_false_without_code_or_error`, `isAuthCallbackUrl_false_for_other_scheme_or_path` (e.g. `https://evil.example/auth/callback?code=x` and `app.pigeonpost://other?code=x`), `isAuthCallbackUrl_false_for_garbage_string`.
- [ ] **Step 2: Run** `npx vitest run test/authUrls.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the three functions and constant with the signatures above; parse with `new URL` inside try/catch (garbage returns false).
- [ ] **Step 4: Run** the same command. Expected: 8 passed.
- [ ] **Step 5: Commit** `feat(auth): native OAuth redirect URI helpers`.

---

### Task 2: Native sign-in via Custom Tab

**Files:**
- Create: `src/lib/nativeAuth.ts`
- Modify: `src/lib/auth.ts` (redirect URI, sign-out URI, navigator), `src/main.tsx` (start the listener), `package.json` (`npm i @capacitor/browser`)
- Test: `test/nativeAuth.test.ts`; keep `test/auth.test.ts` green

**Interfaces:**
- Consumes: `callbackUri`, `signOutUri`, `isAuthCallbackUrl` (Task 1); `isNativeApp()`; oidc-client-ts `INavigator`/`IWindow` (`prepare(params): Promise<IWindow>`, `navigate({url}): Promise<NavigateResponse>`, `close()`).
- Produces:
  - `export type BrowserLike = { open(o: { url: string }): Promise<void>; close(): Promise<void> }`
  - `export function createBrowserNavigator(browser: BrowserLike): INavigator` whose window's `navigate` opens `params.url` in the browser and returns a promise that never resolves (the app finishes via the deep link, like a redirect); its `close` closes the browser.
  - `export type UrlOpenSource = { onUrlOpen(cb: (url: string) => void): () => void }`
  - `export function startAuthListener(src: UrlOpenSource, finish: (url: string) => Promise<string>, go: (to: string) => void, browser: BrowserLike): () => void` which, for each callback URL accepted by `isAuthCallbackUrl`, closes the browser, awaits `finish(url)` once per distinct URL, and calls `go(path)`; failures call `go('/signin')`. Non-callback URLs are ignored.
  - In `auth.ts`: `export async function completeNativeSignIn(url: string): Promise<string>` calls `um().signinCallback(url)` and returns the stored return path like `completeSignIn`.

- [ ] **Step 1: Write failing tests** in `test/nativeAuth.test.ts`: `navigator_navigate_opens_the_browser_with_the_signin_url`, `navigator_navigate_never_resolves` (race against a resolved promise), `listener_ignores_non_callback_urls`, `listener_finishes_once_for_a_duplicate_url`, `listener_closes_browser_then_navigates_to_returned_path`, `listener_goes_to_signin_when_finish_rejects`, `listener_stop_function_unsubscribes`. Add to `test/auth.test.ts`: `completeNativeSignIn_passes_the_url_to_signinCallback_and_returns_returnTo`.
- [ ] **Step 2: Run** `npx vitest run test/nativeAuth.test.ts test/auth.test.ts`. Expected: new tests FAIL (module/export missing), old auth tests pass.
- [ ] **Step 3: Implement** the interfaces. In `auth.ts` build `UserManager` with `redirect_uri: callbackUri(isNativeApp(), location.origin)`, `post_logout_redirect_uri` unchanged in meaning, pass `createBrowserNavigator(Browser)` as the second constructor argument only when native, and use `signOutUri(...)` in the manual logout URL. In `main.tsx`, when native, call `startAuthListener` with a source wrapping `App.addListener('appUrlOpen', ...)` from `@capacitor/app`, `completeNativeSignIn`, a `go` that navigates inside the router without a page reload (expose the router's `navigate` through a small module-level ref set from `App.tsx`), and `Browser` from `@capacitor/browser`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: all pass (276 + new), `tsc` clean.
- [ ] **Step 5: Commit** `feat(auth): sign in through a Custom Tab and the app deep link`.

---

### Task 3: Preferences-backed token storage

**Files:**
- Create: `src/lib/prefsStorage.ts`
- Modify: `src/lib/auth.ts` (store choice), `package.json` (`npm i @capacitor/preferences`)
- Test: `test/prefsStorage.test.ts`

**Interfaces:**
- Consumes: oidc-client-ts `AsyncStorage` (`length: Promise<number>`, `clear`, `getItem`, `key(index)`, `removeItem`, `setItem`, all Promise based).
- Produces:
  - `export type PrefsLike = { get(o: { key: string }): Promise<{ value: string | null }>; set(o: { key: string; value: string }): Promise<void>; remove(o: { key: string }): Promise<void>; keys(): Promise<{ keys: string[] }>; clear(): Promise<void> }`
  - `export function createPrefsStorage(prefs: PrefsLike, prefix?: string): AsyncStorage` (default prefix `oidc.`); every key is namespaced by the prefix and `clear`/`length`/`key` only see prefixed keys.
  - In `auth.ts`: the `WebStorageStateStore` receives `createPrefsStorage(Preferences)` when native, otherwise `localStorage` as today.

- [ ] **Step 1: Write failing tests** with an in-memory fake `PrefsLike`: `set_then_get_roundtrips`, `get_missing_key_is_null`, `removeItem_deletes`, `keys_are_prefixed_so_other_prefs_are_untouched`, `clear_removes_only_prefixed_keys`, `length_and_key_count_only_prefixed`, `getItem_returns_null_not_throw_when_prefs_throws` (fake rejects), `setItem_propagates_failure` (so a failed token write is visible).
- [ ] **Step 2: Run** `npx vitest run test/prefsStorage.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `createPrefsStorage`. Note in the file header that Preferences is app-private storage, not Keystore-encrypted; hardening with an encrypted store is a follow-up.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(auth): keep tokens in Capacitor Preferences on Android`.

---

### Task 4: Cognito, CORS and manifest configuration

**Files:**
- Modify: `template.yaml` (UserPoolClient `CallbackURLs`/`LogoutURLs`, HttpApi CORS `AllowedOrigins`), `android/app/src/main/AndroidManifest.xml` (intent filter)
- Test: `test/nativeConfig.test.ts`

**Interfaces:**
- Produces: nothing for code; this is the contract Tasks 1-2 depend on at runtime.

- [ ] **Step 1: Write failing tests** reading the files as text: `template_allows_native_callback_and_logout_uris` (contains `app.pigeonpost://auth/callback` and `app.pigeonpost://signin`), `template_cors_allows_https_localhost` (`https://localhost` appears under `AllowedOrigins`), `manifest_declares_the_app_pigeonpost_scheme` (an `<intent-filter>` with `android:scheme="app.pigeonpost"`, `android.intent.action.VIEW`, and `BROWSABLE`), `manifest_main_activity_launch_mode_is_singleTask_or_singleTop` (so the callback returns to the same activity).
- [ ] **Step 2: Run** `npx vitest run test/nativeConfig.test.ts`. Expected: 4 FAIL.
- [ ] **Step 3: Edit** the three files so the assertions hold, keeping existing entries (web callbacks stay).
- [ ] **Step 4: Run** `npx vitest run test/nativeConfig.test.ts` (Expected: 4 passed) and `sam validate --lint` if SAM CLI is available (else note it was not run).
- [ ] **Step 5: Commit** `feat(infra): allow the Android OAuth scheme and WebView origin`. Deploying the stack is a manual step after review.

---

### Task 5: Native screen-state source and the backgrounding rule

**Files:**
- Create: `src/lib/nativeScreen.ts`
- Modify: `src/screens/Focus.tsx` (pass the native source into `createPresence` when native)
- Test: `test/nativeScreen.test.ts`; extend `test/presence.test.ts`

**Interfaces:**
- Consumes: `ScreenState` from `src/lib/idle.ts`; `createPresence` deps `screen: () => ScreenState`, `onScreen(cb) => unsubscribe`; `DECIDE_MS`, `UNLOCK_GRACE_MS`.
- Produces:
  - `export type ScreenEvents = { onScreenOff(cb: () => void): () => void; onScreenOn(cb: () => void): () => void }`
  - `export function nativeScreenSource(ev: ScreenEvents): { screen: () => ScreenState; onScreen: (cb: (s: ScreenState) => void) => () => void; stop(): void }` mapping screen off to the locked state and screen on to the unlocked state; `screen()` reflects the latest event, starting unlocked.

- [ ] **Step 1: Write failing tests**. `nativeScreen.test.ts`: `starts_unlocked`, `screen_off_event_reports_locked_to_subscribers`, `screen_on_event_reports_unlocked`, `unsubscribe_stops_callbacks`, `stop_unsubscribes_from_native_events`. In `presence.test.ts` add the decided rule with the native source: `screen_off_with_app_in_front_never_leaves` (hidden then locked within `DECIDE_MS`, advance 60 s, state `locked`, `onLeave` not called), `home_button_leaves` (hidden with screen still unlocked, advance `DECIDE_MS`, `onLeave` called once), `screen_off_then_other_app_before_screen_on_leaves` (locked, then screen on while page stays hidden for more than `UNLOCK_GRACE_MS`, `onLeave` called), `screen_on_with_page_visible_resumes_present`.
- [ ] **Step 2: Run** `npx vitest run test/nativeScreen.test.ts test/presence.test.ts`. Expected: new tests FAIL; if a presence test already passes, keep it as a pinned behaviour and say so in the report (it means `presence.ts` already implements the rule, which is expected).
- [ ] **Step 3: Implement** `nativeScreenSource`. Change `presence.ts` only if a presence test fails, and then minimally. In `Focus.tsx`, when `isNativeApp()`, build the source from the plugin events of Task 6 and pass its `screen`/`onScreen`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(flight): native screen state drives the lock-versus-leave rule`.

---

### Task 6: Flight plugin bridge and keep-alive facade

**Files:**
- Create: `src/lib/flightPlugin.ts`, `src/lib/flightHost.ts`
- Modify: `src/screens/Focus.tsx` (import from `flightHost` instead of `keepAlive`)
- Test: `test/flightHost.test.ts`

**Interfaces:**
- Consumes: `keepAlive.ts` exports `ensureKeepAlive(meta)`, `releaseKeepAlive(graceMs?)`, `isKeepAliveActive()`, `setKeepAliveMeta`, `setKeepAlivePosition`; `KeepAliveMeta = { title; artist?; artworkUrl? }`.
- Produces:
  - `export type FlightNative = { start(o: { title: string; text: string; endsAtMs: number }): Promise<void>; stop(): Promise<void>; onScreenOff(cb): () => void; onScreenOn(cb): () => void; onEndRequested(cb): () => void }`
  - `flightPlugin.ts`: `export const FlightNativePlugin: FlightNative` created with `registerPlugin('Flight')` (Task 7 implements the native side).
  - `flightHost.ts`: same exported names as `keepAlive.ts` used by Focus (`ensureKeepAlive`, `releaseKeepAlive`, `isKeepAliveActive`, `setKeepAliveMeta`, `setKeepAlivePosition`) plus `export function createFlightHost(native: FlightNative | null, web = keepAliveApi): FlightHostApi`; with `native === null` every call delegates to the web implementation unchanged.

- [ ] **Step 1: Write failing tests** with a fake `FlightNative` and fake web api: `web_host_delegates_every_call_to_keepAlive`, `native_ensure_starts_the_service_once_for_repeated_calls`, `native_ensure_resolves_true_when_service_started`, `native_ensure_resolves_false_when_start_rejects` (so the caller can show its screen-lock prompt), `native_release_stops_service_after_grace_unless_ensure_comes_first` (fake timers; chained slots must not kill the service), `native_isActive_reflects_started_state`.
- [ ] **Step 2: Run** `npx vitest run test/flightHost.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** both files; `flightHost` default export picks `FlightNativePlugin` when `isNativeApp()` else `null`. Replace the `keepAlive` import in `Focus.tsx`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: all pass, including `test/keepAlive.test.ts` untouched.
- [ ] **Step 5: Commit** `feat(flight): route keep-alive through a host that can be native`.

---

### Task 7: Android foreground service and plugin (Kotlin)

**Files:**
- Create: `android/app/src/main/java/app/pigeonpost/FlightService.kt`, `FlightPlugin.kt`
- Modify: `android/app/src/main/AndroidManifest.xml` (permissions, service), `MainActivity` (register the plugin), `android/app/build.gradle` (Kotlin plugin if absent)
- Test: build check (`./gradlew :app:assembleDebug`); a static manifest test in `test/nativeConfig.test.ts`

**Interfaces:**
- Produces: a Capacitor plugin named `Flight` with methods `start({title,text,endsAtMs})`, `stop()` and events `screenOff`, `screenOn`, `endRequested`, matching `FlightNative` (Task 6).

- [ ] **Step 1: Write failing manifest tests** in `test/nativeConfig.test.ts`: `manifest_declares_foreground_service_permissions` (`FOREGROUND_SERVICE`, the chosen service-type permission, `POST_NOTIFICATIONS`), `manifest_declares_FlightService_with_foregroundServiceType`. Expected: FAIL.
- [ ] **Step 2: Implement** `FlightService` (a foreground service posting an ongoing notification titled with the destination, with an "End flight" action that emits `endRequested`, auto-stop at `endsAtMs`), and a `BroadcastReceiver` for `ACTION_SCREEN_OFF`/`ACTION_SCREEN_ON` registered while the service runs, forwarding as `screenOff`/`screenOn`. `FlightPlugin` starts and stops the service and relays events. Create the notification channel `flight` (low importance). Use `foregroundServiceType="specialUse"` with the required `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` declaration.
- [ ] **Step 3: Run** `npx vitest run test/nativeConfig.test.ts`. Expected: pass. Then `cd android && ./gradlew :app:assembleDebug`. Expected: BUILD SUCCESSFUL. **If no Android SDK is available in the environment, report that the Kotlin was not compiled; do not claim it builds.**
- [ ] **Step 4: Commit** `feat(android): foreground service and Flight plugin`.

---

### Task 8: Checkpoint notifications on Android

**Files:**
- Create: `src/lib/checkpointPlan.ts`
- Modify: `src/lib/checkpointAlert.ts` (native path), `src/screens/Focus.tsx` (schedule on start, cancel on end/leave), `package.json` (`npm i @capacitor/local-notifications`)
- Test: `test/checkpointPlan.test.ts`; extend `test/checkpointAlert.test.ts`

**Interfaces:**
- Consumes: stop timing from `src/lib/stops.ts` (`stopsAhead(routeKm, fromKm, slotMin): number[]` returns km marks) and `flight.ts` (100 km per minute clock).
- Produces:
  - `export type PlannedAlert = { id: number; atMs: number; place: string }`
  - `export function planCheckpointAlerts(o: { startMs: number; startKm: number; stopKms: number[]; places: string[]; nowMs: number; kmPerMin?: number }): PlannedAlert[]` returns alerts only for stops still in the future, with stable positive integer ids, ordered by time.
  - `export type LocalNotifierLike = { schedule(a: PlannedAlert[]): Promise<void>; cancelAll(): Promise<void> }`
  - `checkpointAlert.ts`: `export async function scheduleCheckpoints(n: LocalNotifierLike, plan: PlannedAlert[])` and `cancelCheckpoints(n)`; the existing web `alertCheckpoint` is unchanged.

- [ ] **Step 1: Write failing tests**: `plan_skips_stops_already_passed`, `plan_times_follow_the_100_km_per_minute_clock`, `plan_ids_are_unique_and_stable_for_same_input`, `plan_empty_when_no_future_stops`, `schedule_calls_notifier_with_the_plan`, `cancel_calls_cancelAll`, `schedule_swallows_notifier_failure_and_resolves` (never breaks the flight).
- [ ] **Step 2: Run** `npx vitest run test/checkpointPlan.test.ts test/checkpointAlert.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the pure planner and wrappers; wire `Focus.tsx` so a flight start schedules, and ending, landing or leaving (freeze) cancels. Request `POST_NOTIFICATIONS` through the plugin's permission API where `Settings.tsx` currently asks the web `Notification` permission, only when native.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(flight): schedule checkpoint notifications natively`.

---

### Task 9: Back button, safe areas and status bar

**Files:**
- Create: `src/lib/nativeChrome.ts`
- Modify: `src/main.tsx` or `src/App.tsx` (init once), `src/components/Layout.tsx`, `src/components/BottomNav.tsx`, `src/index.css`, `index.html` (`viewport-fit=cover`)
- Test: `test/nativeChrome.test.ts`

**Interfaces:**
- Produces:
  - `export type BackContext = { path: string; flightActive: boolean; dialogOpen: boolean; canGoBack: boolean }`
  - `export type BackAction = 'close-dialog' | 'confirm-end-flight' | 'navigate-back' | 'exit-app'`
  - `export function decideBack(c: BackContext): BackAction`: dialog first; an active flight asks to confirm ending it; otherwise navigate back if history exists; `exit-app` only at `/home` with no history and no flight.
  - `export function applyNativeClasses(root: { classList: { add(c: string): void } }): void` adds the class `native-app` used by CSS (safe-area padding on `Layout`/`BottomNav`, no desktop centered-column cap).

- [ ] **Step 1: Write failing tests**: `dialog_open_closes_dialog_first`, `active_flight_asks_to_confirm`, `history_available_navigates_back`, `home_without_history_exits`, `non_home_without_history_navigates_to_home_not_exit` (returns `navigate-back`), `applyNativeClasses_adds_native_app`.
- [ ] **Step 2: Run** `npx vitest run test/nativeChrome.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two functions; register `App.addListener('backButton', ...)` once when native, building the context from the router and the Focus/dialog state; implement `confirm-end-flight` with the existing end-flight confirm UI; add CSS using `env(safe-area-inset-*)` under `.native-app`, and set the status bar style with `@capacitor/status-bar` (cream background, dark icons).
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(android): back button, safe areas and status bar`.

---

### Task 10: Native share and speech gating

**Files:**
- Create: `src/lib/share.ts`
- Modify: `src/screens/ShareStamps.tsx`, `src/screens/JournalDetail.tsx`, `src/screens/TripComposer.tsx`, `package.json` (`npm i @capacitor/share @capacitor/filesystem`)
- Test: `test/share.test.ts`

**Interfaces:**
- Produces:
  - `export type ShareDeps = { native: boolean; nativeShare?: (o: { title: string; text?: string; url?: string; files?: string[] }) => Promise<void>; writeTemp?: (name: string, base64: string) => Promise<string>; webShare?: (d: ShareData) => Promise<void> }`
  - `export async function shareImage(png: Blob, title: string, d: ShareDeps): Promise<'shared' | 'unsupported'>`: native writes the PNG to a temp file and calls `nativeShare` with its URI; web uses `webShare` with a `File`; no capability returns `'unsupported'` so the caller falls back to download.
  - `export async function shareLink(o: { title: string; text?: string; url?: string }, d: ShareDeps): Promise<'shared' | 'unsupported'>`
  - `export function speechAvailable(w: object): boolean`: true only if `SpeechRecognition` or `webkitSpeechRecognition` exists on `w` and the app is not an Android WebView (user agent contains `; wv)`).

- [ ] **Step 1: Write failing tests**: `native_image_share_writes_file_then_shares_its_uri`, `web_image_share_passes_a_png_file`, `no_share_capability_returns_unsupported`, `user_cancel_is_not_an_error` (the share call rejecting with `AbortError` or a `Share canceled` message resolves `'shared'`, so the caller does not fall back to a download), `speechAvailable_false_in_android_webview`, `speechAvailable_true_in_chrome_with_api`, `speechAvailable_false_without_api`.
- [ ] **Step 2: Run** `npx vitest run test/share.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three functions; replace the inline `navigator.share` and download paths in `ShareStamps.tsx`/`JournalDetail.tsx` with calls that fall back to the existing download when `'unsupported'`; hide the mic button in `TripComposer.tsx` when `!speechAvailable(window)`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(android): native share sheet and speech availability`.

---

### Task 11: Asset diet

**Files:**
- Modify: `src/assets/Coo_1.wav` and `Coo_2.wav` (replace with `.ogg`), `src/lib/sound.ts` and any import of the coos, `src/assets/web_bird_bg.png` (replace with WebP) and its importers
- Create: `scripts/assets-budget.mjs` (optional helper)
- Test: `test/assetBudget.test.ts`

**Interfaces:**
- Produces: a budget test other tasks cannot silently break.

- [ ] **Step 1: Write the failing test** `test/assetBudget.test.ts`: `no_single_file_in_src_assets_exceeds_1_MB` and `total_src_assets_under_4_MB` (read sizes with `fs.statSync`), plus `no_wav_files_in_src_assets`.
- [ ] **Step 2: Run** `npx vitest run test/assetBudget.test.ts`. Expected: FAIL (26 MB and 17 MB files).
- [ ] **Step 3: Convert**: coos to mono 64 kbps `.ogg` (ffmpeg), the large background to WebP at 1080 px wide, keeping filenames referenced in code updated; delete the originals. Keep visual and audible parity (state ffmpeg/cwebp commands used in the report).
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b && npm run build`. Expected: tests pass, build succeeds, `du -sh dist` reported (target under 15 MB).
- [ ] **Step 5: Commit** `perf: shrink coo sounds and background art`.

---

### Task 12: Block and report API

**Files:**
- Create: `api/src/handlers/blocks.ts`, `api/src/handlers/reports.ts`
- Modify: `api/src/lib/keys.ts` (block and report keys), `api/src/handlers/friends.ts` (reject requests involving a block), `api/src/handlers/compose.ts` (reject letters to or from a blocked user), `template.yaml` (functions and routes), `src/lib/types.ts` (shared types)
- Test: `api/test/blocks.test.ts`, `api/test/reports.test.ts`; extend `api/test/friends.test.ts`, `api/test/letters.test.ts`

**Interfaces:**
- Produces: `POST /blocks/{id}` (block, also removes the friendship rows), `DELETE /blocks/{id}`, `GET /blocks` returns `{ ids: string[] }`; `POST /reports` body `{ targetId: string; kind: 'user' | 'letter'; reason: 'spam' | 'harassment' | 'inappropriate' | 'other'; note?: string (max 500 code points); letterId?: string }` stores a report row and returns 204. Handlers follow `route(...)`/`HttpError` from `api/src/lib/http.ts`.

- [ ] **Step 1: Write failing tests** in the style of `api/test/friends.test.ts` (in-memory table): `block_creates_a_row_and_removes_friendship_both_ways`, `block_self_is_400`, `block_is_idempotent`, `unblock_removes_the_row`, `list_returns_only_my_blocks`, `friend_request_to_a_user_who_blocked_me_is_403`, `friend_request_to_someone_i_blocked_is_403`, `letter_to_a_blocked_user_is_403_and_nothing_is_stored`, `report_stores_row_and_returns_204`, `report_rejects_unknown_reason_400`, `report_note_over_500_code_points_400`, `report_requires_auth_401`.
- [ ] **Step 2: Run** `npm --prefix api test -- blocks reports friends letters`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** handlers and checks, add the SAM functions and routes mirroring `FriendsFunction` in `template.yaml`, and an SES notification to a moderator address read from a new SAM parameter `ModeratorEmail` (skipped when empty).
- [ ] **Step 4: Run** `npm --prefix api test && npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(api): block users and report content`.

---

### Task 13: Block and report UI, Terms and age gate

**Files:**
- Create: `src/lib/strings.ts`, `src/lib/safety.ts`
- Modify: `src/screens/Friends.tsx`, `src/screens/OpenedLetter.tsx`, `src/screens/SignIn.tsx` (age and terms confirmation), `src/lib/types.ts`/`store.ts` (`ageConfirmedAt`, `blockedIds`)
- Test: `test/safety.test.ts`

**Interfaces:**
- Consumes: Task 12 endpoints through `api()` and the outbox pattern in `src/lib/outbox.ts`.
- Produces:
  - `strings.ts`: `export const S = { ... } as const` with all new copy (block, report, reasons, terms, age gate).
  - `export async function blockUser(id: string): Promise<void>` (optimistic: updates the store, queues the call offline), `unblockUser`, `reportContent(r: ReportInput): Promise<void>`.
  - `export function canContinueSignIn(s: { ageConfirmed: boolean; termsAccepted: boolean }): boolean` true only when both are true.

- [ ] **Step 1: Write failing tests**: `canContinueSignIn_requires_both_boxes`, `blockUser_updates_store_immediately`, `blockUser_queues_when_offline_and_flushes_later`, `blockedIds_hide_that_users_letters_in_the_mailbox_selector`, `reportContent_posts_the_expected_body`, `reportContent_failure_is_queued_not_lost`.
- [ ] **Step 2: Run** `npx vitest run test/safety.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and UI: Block and Report actions on friend rows and opened letters with a confirm dialog, and the age/terms checkbox gate on `SignIn.tsx` (links to `/terms.html`, `/privacy.html`); text stated as "13 or older, or the minimum age in your country".
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: block, report and an age-and-terms gate`.

---

### Task 14: Credits and legal pages

**Files:**
- Create: `src/screens/Credits.tsx`, `src/lib/credits.ts`, `public/privacy.html`, `public/terms.html`, `public/delete-account.html`
- Modify: `src/App.tsx` (route `/credits`), `src/screens/Settings.tsx` (link and a visible delete-account button wired to `DELETE /me` if not already)
- Test: `test/credits.test.ts`

**Interfaces:**
- Produces: `export const CREDITS: { name: string; author?: string; license: string; url?: string }[]` listing every bundled bird model (read `SKETCHFAB_MODELS.md` and the README), OpenStreetMap/OpenFreeMap, Natural Earth, GeoNames, Wikipedia, GBIF, iNaturalist, Open-Meteo.

- [ ] **Step 1: Write failing tests**: `credits_include_every_bird_model_file_in_public_models` (list `public/models/*.glb` and require each basename to appear in some credit name or `models` field), `credits_include_openstreetmap_geonames_wikipedia`, `every_credit_has_a_license`, `legal_pages_exist_and_are_non_empty` (privacy, terms, delete-account HTML, each mentions the contact email placeholder `privacy@pigeonpost.app`), `delete_account_page_explains_in_app_and_email_paths`.
- [ ] **Step 2: Run** `npx vitest run test/credits.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write** the data, screen, and pages. The privacy page covers: data collected (email, name, picture, home city, journeys, letters), purposes, retention, GDPR/CCPA rights, AWS `us-east-1` storage, and 13+ age. Mark any model without a confirmed licence in the report so a human resolves it (do not invent licences).
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: credits screen and legal pages`.

---

### Task 15: Weather through the API

**Files:**
- Create: `api/src/handlers/weather.ts`
- Modify: `src/lib/weather.ts` (call `GET /weather?lat&lng` when configured), `template.yaml` (function, route, parameter `OpenMeteoApiKey`, optional)
- Test: `api/test/weather.test.ts`; extend `test/windField.test.ts` or a new `test/weather.test.ts`

**Interfaces:**
- Consumes: `Wind` type in `src/lib/weather.ts` (`{ speedKmh; fromDeg; tempC }`); `windAt(lat, lng): Promise<Wind | null>`.
- Produces: `GET /weather?lat=&lng=` returns `Wind` JSON, validates and rounds coordinates to 1 decimal, caches per rounded cell for 10 minutes in memory, sends the commercial key header when `OPEN_METEO_API_KEY` is set.

- [ ] **Step 1: Write failing tests**: API `weather_rejects_missing_or_out_of_range_coordinates_400`, `weather_rounds_coordinates_so_nearby_requests_share_a_cache_entry`, `weather_uses_api_key_when_configured`, `weather_upstream_failure_returns_502_not_500`; web `windAt_uses_the_api_when_COGNITO_configured`, `windAt_returns_null_on_failure`.
- [ ] **Step 2: Run** `npm --prefix api test -- weather` and `npx vitest run test/weather.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the handler and switch the client; offline dev (no Cognito config) keeps calling Open-Meteo directly as today.
- [ ] **Step 4: Run** `npm --prefix api test && npx vitest run && npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(api): proxy weather so the commercial key stays server-side`.

---

### Task 16: Push notifications for letters

**Files:**
- Create: `api/src/handlers/devices.ts`, `src/lib/push.ts`
- Modify: `api/src/lib/notify.ts` (send on delivery), `template.yaml`, `src/lib/types.ts`, `src/screens/Settings.tsx` (`notifyLetters` toggle), `package.json` (`npm i @capacitor/push-notifications`)
- Test: `api/test/devices.test.ts`, `api/test/notify.test.ts`, `test/push.test.ts`

**Interfaces:**
- Produces: `PUT /devices` body `{ token: string; platform: 'android' }` stores one row per token for the caller; `DELETE /devices/{token}`; `notify.ts` exports `notifyLetterDelivered(toUserId: string, fromName: string): Promise<void>` that sends via FCM HTTP v1 to every stored token (skipped when `notifyLetters` is off or no token), and deletes tokens FCM reports as unregistered. Client: `export async function registerPush(p: PushLike, put: (token: string) => Promise<void>): Promise<void>`.

- [ ] **Step 1: Write failing tests**: API `devices_put_stores_token_idempotently`, `devices_delete_removes_token`, `notify_sends_to_each_token`, `notify_removes_unregistered_tokens`, `notify_skipped_when_user_disabled_letters`, `notify_failure_does_not_fail_letter_delivery`; web `registerPush_requests_permission_then_puts_the_token`, `registerPush_does_nothing_when_permission_denied`.
- [ ] **Step 2: Run** `npm --prefix api test -- devices notify` and `npx vitest run test/push.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with the FCM service account read from Secrets Manager via a SAM parameter (never in the repo); register after sign-in when native.
- [ ] **Step 4: Run** `npm --prefix api test && npx vitest run && npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: push notifications when a letter arrives`.

---

### Task 17: Android release workflow

**Files:**
- Create: `.github/workflows/android.yml`, `docs/android-release.md`
- Test: `test/workflows.test.ts`

**Interfaces:**
- Produces: a workflow `android` that on `workflow_dispatch` and on tags `android-v*` builds the web bundle with `.env.android` values, runs `npx cap sync android`, builds a signed `bundleRelease`, and uploads to the Play **internal** track.

- [ ] **Step 1: Write failing tests** parsing the YAML: `android_workflow_exists`, `runs_tests_before_building` (a job or step running `npx vitest run` and `npm --prefix api test` precedes the build), `uses_no_inline_secrets` (every secret reference is `${{ secrets.* }}`; no long base64-looking literals), `uploads_to_internal_track_only` (track value `internal`), `pins_java_17_or_21` .
- [ ] **Step 2: Run** `npx vitest run test/workflows.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write** the workflow (decode the keystore from `ANDROID_KEYSTORE_BASE64`, sign with `ANDROID_KEY_ALIAS`/passwords, upload with the Play service-account JSON secret) and `docs/android-release.md` listing the required secrets and the manual promotion to closed and production tracks.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** `ci: signed Android bundle to the Play internal track`.

---

## Manual steps (no task; a human does these)

- Play Console: verify the organization account, public contact details and EU trader status; create the app `app.pigeonpost`; enrol in Play App Signing; fill Data safety (email, name, user content, no purchases, no ads), content rating, target audience 13+, and the privacy and account-deletion URLs.
- Firebase: create the project, download `google-services.json` into CI secrets, enable Crashlytics.
- Deploy the SAM stack after Tasks 4, 12, 15 and 16; fill `.env.android` from the stack outputs.
- Device matrix for Tasks 5-9: Pixel (stock), Samsung (One UI battery optimisation), Xiaomi; record 25-minute flight battery and frame rate; reopen the React Native question if over about 6% drain or under about 24 fps.
- Resolve the three.js example bird licences before any public track.
- Store listing assets: 512 px icon, 1024x500 feature graphic, 4-8 phone screenshots.
- Closed test (5-10 people, about a week) then staged production rollout.
