# Desktop Flight Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On desktop web, a running Focus flight stays visible in a floating, user-movable, user-resizable popup while the user is on other browser tabs, and the popup shows each checkpoint (stop card) when the bird reaches one.

**Architecture:** Use Chrome/Edge's Document Picture-in-Picture window (`window.documentPictureInPicture`) as the popup: it is an always-on-top native window the user drags and resizes freely, which no in-page element can do across tabs. React renders the same `FlightHud`, `BirdViewer`, `StopsRail` and `StopCard` components into it through a portal and reads the same store and `computeProgress` clock logic as the mobile view. While the popup is open, `createPresence` no longer treats a tab switch as leaving, so the flight keeps running instead of freezing. Nothing in `lib/flight.ts` changes: checkpoints already arrive as `stopCards` via `settleElapsedSlots` / `chainFrom`, and the bird already flies on by itself.

**Tech Stack:** React 19, Zustand-style `useStore`, Tailwind 4, vitest (node env, no jsdom), Document PiP API, Notification API.

**Spec:** None on disk. Requirement, from the user's request: (1) after a Focus flight starts, switching tabs leaves the flight-bird popup in a corner, draggable anywhere and resizable, as a reminder to keep working; (2) at a checkpoint the popup either switches to the main Pigeon Post tab and shows the checkpoint place, or resizes to cover the current tab and names the checkpoint; (3) continuing the journey moves the bird forward; (4) reuse the components and logic built for the mobile web view.

## Global Constraints

- Desktop only: `popupSupported()` is false when `isMobileDevice()` is true, so mobile behaviour is unchanged.
- Browsers without `documentPictureInPicture` (Firefox, Safari) keep today's behaviour exactly (tab switch freezes the flight, see `src/lib/presence.ts`); no popup button is shown.
- No new dependencies. Styling is Tailwind classes with the existing tokens (`bg-cream`, `text-ink`, `text-sage`, ...).
- `lib/flight.ts` and the sync/API layers are not modified.
- `pigeon-post/` is not a git repository, so tasks end with a green check run instead of a commit. Run `git init` first if commits are wanted.
- Verification commands, from `pigeon-post/`: `npx vitest run`, `npx tsc -b`, `npx oxlint`.

## Review Focus

- User closes the popup while the main tab is hidden: the flight must freeze (leave) as before, not run forever unattended. Pinned in Task 2.
- No `documentPictureInPicture` or mobile UA: `popupSupported()` false, `openPopup()` resolves `null`, no throw. Pinned in Task 1.
- `resizeTo` throws (Chrome requires user activation): swallowed, popup still shows the checkpoint at its current size. Pinned in Task 1.
- Notifications denied, unsupported, or `settings.notifyBird` off at a checkpoint: no throw, popup still shows the card. Pinned in Task 3.
- Several checkpoints queued while away: popup shows "Next card" and "1 of N" exactly like mobile. Covered by reusing `StopCard` unchanged (Task 4 manual check).
- Flight ends or lands (End flight, arrival) while the popup is open: popup closes, no orphan window. Pinned in Task 5 manual check.

---

## File Structure

- Create `src/lib/pip.ts`: Document PiP wrapper, module singleton, `usePopup` hook, style copying, resize helper.
- Create `src/lib/checkpointAlert.ts`: Notification for a reached checkpoint.
- Create `src/components/FlightHud.tsx`: the countdown / destination / progress ring / `StopsRail` block now inline in `Focus.tsx`, extracted so the popup reuses it.
- Create `src/components/FlightPopup.tsx`: the portal content (compact flight view and checkpoint view).
- Modify `src/lib/presence.ts`: optional `pipActive` dep.
- Modify `src/components/StopCard.tsx`: `inline` prop (no absolute bottom sheet).
- Modify `src/screens/Focus.tsx`: use `FlightHud`, mount `FlightPopup`, pass `pipActive`, "Pop out" button, close on unmount.
- Modify `src/screens/Dashboard.tsx`, `src/screens/TripComposer.tsx`: best-effort `openPopup()` inside the start click.
- Tests: `test/pip.test.ts`, `test/checkpointAlert.test.ts`, extend `test/presence.test.ts`.

---

### Task 1: Document PiP wrapper

**Files:**
- Create: `src/lib/pip.ts`
- Test: `test/pip.test.ts`

**Interfaces:**
- Consumes: `isMobileDevice(nav?)` from `src/lib/presence.ts`.
- Produces:
  - `popupSupported(): boolean`: `'documentPictureInPicture' in globalThis` and not mobile.
  - `POPUP_SIZE = { width: 320, height: 420 }`, `CHECKPOINT_SIZE = { width: 440, height: 600 }`.
  - `openPopup(): Promise<Window | null>`: idempotent (returns the open window); `null` when unsupported or `requestWindow` rejects; copies styles; clears the singleton on the window's `pagehide`.
  - `closePopup(): void`, `getPopup(): Window | null`, `usePopup(): Window | null` (via `useSyncExternalStore`).
  - `resizePopup(size: { width: number; height: number }): boolean`: `resizeTo`, `false` if it throws or no popup.
  - `copyStyles(from: Document, to: Document): void`: clones every `link[rel=stylesheet]` and `style` node into `to.head`.

- [x] **Step 1: Write failing tests in `test/pip.test.ts`** using a fake `globalThis.documentPictureInPicture = { requestWindow }` returning an `EventTarget` window with `document`, `close()`, `resizeTo`. Tests:
  - `openPopup resolves null and does not throw when documentPictureInPicture is missing`
  - `openPopup returns the same window on a second call and requests only once`
  - `getPopup is null after the window fires pagehide`
  - `resizePopup returns false when resizeTo throws, true when it succeeds`
  - `copyStyles clones each stylesheet node into the target head` (fake documents whose `querySelectorAll` returns nodes with `cloneNode`, target `head.appendChild` records calls)
  - `popupSupported is false for a mobile user agent` (stub `navigator` via `vi.stubGlobal`)
- [x] **Step 2: Run** `npx vitest run test/pip.test.ts`. Expected: FAIL, module not found.
- [x] **Step 3: Implement `src/lib/pip.ts`** with the signatures above. Singleton plus a listener `Set` for `usePopup`, same shape as the `useStore` subscription in `src/lib/store.ts`. Open with `requestWindow({ width: POPUP_SIZE.width, height: POPUP_SIZE.height })`.
- [x] **Step 4: Run** `npx vitest run test/pip.test.ts`. Expected: PASS.
- [x] **Step 5: Run** `npx tsc -b && npx oxlint`. Expected: no errors.

### Task 2: Presence ignores tab switches while the popup is open

**Files:**
- Modify: `src/lib/presence.ts` (`PresenceDeps`, the `away` function at line 39)
- Test: `test/presence.test.ts`

**Interfaces:**
- Consumes: the existing `setup()` helper in `test/presence.test.ts`.
- Produces: `PresenceDeps.pipActive?: () => boolean`. When it returns true, `away()` is false, so hide/blur do not start the leave timer.

- [x] **Step 1: Add failing tests** (extend `setup` with `pip?: boolean`, passed as `pipActive: () => pip`):
  - `desktop with the popup open: hiding the page does not leave`: `hide()`, `tick(DECIDE_MS + 100)`, `left` is `[]`.
  - `desktop with the popup open: window blur does not leave`.
  - `popup closed while the page is hidden: a fresh controller leaves after DECIDE_MS` (create with `pip: false` after `hide()`, `tick(DECIDE_MS)`, `left.length === 1`). This pins the "closing the popup ends the unattended flight" requirement.
  - `without pipActive behaviour is unchanged` (existing tests keep passing).
- [x] **Step 2: Run** `npx vitest run test/presence.test.ts`. Expected: the first two new tests FAIL.
- [x] **Step 3: Implement**: `const away = () => !deps.pipActive?.() && (doc.visibilityState === 'hidden' || (!mobile && !doc.hasFocus()))`. Update the header comment table with one line for the popup.
- [x] **Step 4: Run** `npx vitest run test/presence.test.ts`. Expected: PASS.

### Task 3: Checkpoint notification

**Files:**
- Create: `src/lib/checkpointAlert.ts`
- Test: `test/checkpointAlert.test.ts`

**Interfaces:**
- Consumes: `getState().settings.notifyBird` from `src/lib/store.ts`.
- Produces: `alertCheckpoint(place: string, onClick: () => void): boolean`. Returns true when a notification was shown. The notification has `tag: 'checkpoint'`, title `Checkpoint reached`, body `Your bird reached ${place}`; its click calls `onClick`. This is the reliable way to bring the main tab forward, because a background page cannot focus itself.

- [x] **Step 1: Write failing tests** with `vi.stubGlobal('Notification', FakeNotification)`:
  - `shows a notification when permission is granted and notifyBird is on` (asserts title, body, tag)
  - `clicking the notification calls onClick`
  - `returns false and shows nothing when permission is denied`
  - `returns false when Notification is undefined`
  - `returns false when settings.notifyBird is false` (use `setState({ settings: { ...defaultSettings, notifyBird: false } })`)
- [x] **Step 2: Run** `npx vitest run test/checkpointAlert.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement `alertCheckpoint`**; wrap construction in try/catch (some browsers throw when called outside a service worker context) and return false.
- [x] **Step 4: Run** `npx vitest run test/checkpointAlert.test.ts`. Expected: PASS.

### Task 4: Extract shared UI (`FlightHud`, `StopCard inline`)

**Files:**
- Create: `src/components/FlightHud.tsx`
- Modify: `src/components/StopCard.tsx` (outer wrapper at line 30), `src/screens/Focus.tsx` (the `<aside>` at lines 293-341)

**Interfaces:**
- Produces:
  - `FlightHud(props: { dest: string; countdown: string; pct: number; stops: number[]; routeKm: number; km: number; action: ReactNode })`: renders the card body from the current aside (header row with `action` slot at the right, countdown, destination, progress ring, `StopsRail`, "Next stop in"). No positioning classes; the caller wraps it.
  - `StopCard` gains `inline?: boolean`. When true the wrapper is a plain `div` (no `absolute inset-x-0 bottom-0 z-[5]`, no `max-h-[46dvh]`, uses `h-full`), so it fills a popup. Default false keeps mobile unchanged.

- [x] **Step 1: Extract `FlightHud`** by moving the aside's inner markup unchanged; the `action` slot receives the existing End flight / Take over button element from `Focus`. Focus keeps the `<aside>` positioning wrapper.
- [x] **Step 2: Add the `inline` prop to `StopCard`**; no other change.
- [x] **Step 3: Run** `npx tsc -b && npx oxlint && npx vitest run`. Expected: all existing tests PASS (pure refactor).
- [ ] **Step 4: Visual regression check**: `preview_start` the dev server, open `/fly/<id>` at mobile and desktop widths, and confirm the HUD looks identical to before.

### Task 5: `FlightPopup` and Focus wiring

**Files:**
- Create: `src/components/FlightPopup.tsx`
- Modify: `src/screens/Focus.tsx`

**Interfaces:**
- Consumes: `usePopup`, `openPopup`, `closePopup`, `resizePopup`, `popupSupported`, `POPUP_SIZE`, `CHECKPOINT_SIZE` (Task 1); `alertCheckpoint` (Task 3); `FlightHud`, `StopCard inline` (Task 4); `BirdViewer`, `birdBySpecies`, `turnRef` already in Focus.
- Produces: `FlightPopup(props: { win: Window; species: BirdSpecies; turnRef: { current: number }; hud: Omit<ComponentProps<typeof FlightHud>, 'action'> & { onEnd: () => void }; card: { story: Story; newStampCc?: string; covered?: { cc: string; country: string }[]; queued: number; onDone: () => void } | null; onOpenTab: () => void })`. It `createPortal`s into `win.document.body`.
  - No card: compact view = `BirdViewer flight` filling the window (container-query sizing, so it scales as the user resizes) with `FlightHud` below it and End flight as the `action`.
  - Card: checkpoint view = `StopCard inline` (place name first, then the existing tabs) above an "Open Pigeon Post" button that calls `onOpenTab` (the click is the user gesture that lets the main tab take focus).
  - "Got it / Next card" is the existing `onDone`; when the last card is dismissed the view returns to compact and the bird, which already chained into the next slot, is seen moving on.

- [x] **Step 1: Implement `FlightPopup`** per the above. Use Tailwind `@container` on the root so the HUD hides the stops rail below ~260px width.
- [x] **Step 2: Wire `Focus.tsx`**:
  - `const win = usePopup()`; pass `pipActive: () => !!getPopup()` to `createPresence` and add `win` to that effect's dependency array so the controller is rebuilt when the popup opens or closes.
  - Render `<FlightPopup>` when `win && flying`, reusing the same `hud` values, `species`, `turnRef` and `cards[0]` / `stories` lookup already computed (extract that IIFE at lines 370-382 into a local `headCard` so both the in-page `StopCard` and the popup use it). While the popup is open and the page is hidden, the in-page `StopCard` is not rendered twice; render it only when `!win`.
  - Checkpoint effect keyed on `headCard?.storyId`: if `win`, `resizePopup(CHECKPOINT_SIZE)` and `alertCheckpoint(story.place, () => window.focus())`. When `headCard` becomes null, `resizePopup(POPUP_SIZE)`.
  - `onOpenTab = () => window.focus()`.
  - Desktop "Pop out" button in the sound/wind row (shown only if `popupSupported() && !win`) calling `void openPopup()`.
  - `useEffect(() => () => closePopup(), [])` so landing, End flight and in-app navigation close the popup.
- [x] **Step 3: Run** `npx tsc -b && npx oxlint && npx vitest run`. Expected: PASS.

### Task 6: Open on start, then verify in Chrome

**Files:**
- Modify: `src/screens/Dashboard.tsx` (`start`, `continueTrip` handlers at lines 62-100), `src/screens/TripComposer.tsx:154`

**Interfaces:**
- Consumes: `popupSupported`, `openPopup` (Task 1).
- Produces: a best-effort `if (popupSupported()) void openPopup()` immediately before each `startSession(...)` call. If the transient activation has expired (the lock-permission prompt intervened) it simply rejects to `null`, and the Focus "Pop out" button is the fallback.

- [x] **Step 1: Add the calls** at the four `startSession`/`startReturn` sites.
- [ ] **Step 2: Manual verification in desktop Chrome** (`preview_start`, then drive it). Confirm each, noting these are assumptions about the platform that the plan relies on:
  1. Start a flight: popup opens in a corner; drag and resize it; contents rescale.
  2. Switch to another browser tab for 60 s: flight does not freeze, countdown continues in the popup, no ResumePrompt on return.
  3. Let a checkpoint arrive (use a short slot or temporarily lower the duration): popup switches to the stop card and attempts to grow; a notification appears; clicking it focuses the Pigeon Post tab. Record whether `resizeTo` actually grew the window without a gesture; if not, the card is shown at the current size and the "Open Pigeon Post" button is the way to the full view.
  4. Tap "Got it": popup returns to the flying view and the bird keeps moving.
  5. Close the popup while on another tab: after a few seconds the flight freezes (leaves) as today.
  6. End flight in the popup: popup closes and the page lands.
  7. Open the app in Firefox or a phone UA: no Pop out button, behaviour unchanged.
- [x] **Step 3: Run** `npx vitest run && npx tsc -b && npx oxlint`. Expected: all PASS.

---

## Implementation Status (2026-10-31)

Branch `claude/youthful-gates-b17ljo`, merged to `main`. Automated checks: `npx vitest run` (263 tests pass), `npx tsc -b` clean, `vite build` OK. `npx oxlint` has one pre-existing error (`HomeCity.tsx`, `useMyLocation` rules-of-hooks) unrelated to this work.

### Implemented
- **Task 1** `src/lib/pip.ts` + `test/pip.test.ts`: Document PiP wrapper, all specified exports.
- **Task 2** `pipActive` in `src/lib/presence.ts` + new cases in `test/presence.test.ts`.
- **Task 3** `src/lib/checkpointAlert.ts` + `test/checkpointAlert.test.ts` (also returns false if the constructor throws).
- **Task 4** `src/components/FlightHud.tsx`, `StopCard` `inline` prop, `Focus.tsx` uses `FlightHud`.
- **Task 5** `src/components/FlightPopup.tsx`, `Focus.tsx` wiring (`usePopup`, presence rebuild on `win`, `headCard`, checkpoint resize + notification effect, "Pop out" button, close on unmount).
- **Task 6 Step 1** `openPopup()` before the three `startSession`/`startReturn` sites in `Dashboard.tsx` and the one in `TripComposer.tsx`.

### Deviations from the plan
- `BirdViewer` now uses the `requestAnimationFrame` / `devicePixelRatio` of the window that owns its element. Otherwise the popup bird freezes while the main tab is hidden.
- `StopCard` tab keyboard navigation focuses via `e.currentTarget.ownerDocument`, since the popup has its own document.
- End flight inside the popup calls `landSession('ended')` directly. The "Land here?" confirm dialog lives in the hidden main tab and would never be seen.
- `Landing.tsx` (`startReturn`) does not open the popup; it was not one of the plan's four sites.
- The repo root is itself a git repo, so the plan's "no git" note no longer applies and work was committed.

### Left to test (needs desktop Chrome/Edge; not run)
- [ ] Task 4 Step 4: visual regression of the HUD at mobile and desktop widths (`/fly/<id>`).
- [ ] Task 6 Step 2.1: start a flight; popup opens in a corner, drags and resizes, contents rescale.
- [ ] 2.2: switch tabs for 60 s; countdown keeps running in the popup, no ResumePrompt on return, bird still animates.
- [ ] 2.3: checkpoint arrives; popup shows the stop card, notification appears, clicking it focuses the tab. Record whether `resizeTo` grows the window without a user gesture.
- [ ] 2.4: "Got it" returns to the flying view and the bird keeps moving; several queued cards show "Next card" / "1 of N".
- [ ] 2.5: close the popup while on another tab; flight freezes after a few seconds as before.
- [ ] 2.6: End flight in the popup closes it and lands the page; arrival also closes it.
- [ ] 2.7: Firefox / phone UA show no Pop out button and behave as before.
- [ ] Whether the popup open on flight start succeeds after the lock-permission prompt, or only the Pop out fallback works.

## Self-Review

- **Coverage:** popup persists across tabs, draggable and resizable (native PiP, Task 1/5); checkpoint switches to main tab (notification click + button, Task 3/5) and also grows the popup (Task 5); journey continues (existing chaining, verified Task 6); mobile logic reused (`computeProgress`, `StopCard`, `StopsRail`, `BirdViewer`, presence, store).
- **Types:** `popupSupported`, `openPopup`, `closePopup`, `getPopup`, `usePopup`, `resizePopup`, `POPUP_SIZE`, `CHECKPOINT_SIZE`, `alertCheckpoint`, `FlightHud`, `FlightPopup` and `pipActive` are named identically wherever used.
