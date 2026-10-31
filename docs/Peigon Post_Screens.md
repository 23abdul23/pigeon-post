# Pigeon Post: Stitch prompt for 18 screens

How to use: Stitch loses quality when one prompt asks for too many screens. Paste the GLOBAL BLOCK first, then ONE part at a time (Part 1, then Part 2, then Part 3). Repeat the GLOBAL BLOCK at the top of each part.

---

## GLOBAL BLOCK (paste before every part)

```
App: "Pigeon Post", a calm focus-timer web app. The user starts a focus session, a 3D bird (origami or realistic) flies across the real world on a map while they stay focused, lands at a place, and shows a short story about that place. Friends can send each other letters that a bird carries.

Deliver every screen in two layouts: desktop web (1440px wide) and mobile (390px wide).

Visual style: light theme only, cozy, calm, paper-map feel.
Colors: background cream #FBF6EE, cards warm sand #F3EADB, primary sage green #7FA38A, secondary dusty sky blue #9DB9C9, single warm accent terracotta #D98B6A (used only for the one main action button on a screen), text soft brown #3E3A36, muted text #8A8178, borders #E6DCCB.
Fonts: Fraunces (headings, place names, letter titles), Nunito (body, buttons, labels). Handwriting font (Caveat) only inside letters.
Shape: 20px rounded corners on cards, 999px on pills and buttons, soft low shadows, generous whitespace, 24px spacing grid.
Icons: one consistent rounded line-icon set.
Navigation (all screens after onboarding): desktop top bar with logo "Pigeon Post" at left; links Home, Mailbox (with badge for unopened letters), Friends, Passport, Journal; at right a sound on/off icon and the user's avatar menu (Settings, Sign out). On mobile: bottom tab bar with Home, Mailbox, Friends, Passport, Journal; sound toggle and avatar in a slim top bar.
Tone of copy: warm, short, gentle. No guilt, no pressure.
No dark mode, no neon, no clutter.
```

---

## PART 1: Onboarding, dashboard, focus loop (screens 1 to 7)

```
SCREEN 1: Sign in (onboarding step 1 of 3)
- Centered card on a soft illustrated cream background with a faint paper map and a small origami bird flying across the top.
- Logo, headline "Fly while you focus", subtext "Pick a place, stay on this tab, and your bird travels there.".
- One large button "Continue with Google" with the Google logo.
- Small privacy line under it: "We only ever share your city, never your exact location."
- Step indicator "1 of 3" (three dots).
- Footer links: Terms, Privacy.
- States: default, loading (button spinner), sign-in error ("Couldn't sign in. Try again.").

SCREEN 2: Home city (onboarding step 2 of 3)
- Heading "Where is home?", subtext "Your bird starts and returns here. City level only.".
- Single large search field with a pin icon, placeholder "Type your city". As the user types, a suggestion list drops down showing city, region, country with a small flag (for example "Hyderabad, Telangana, India").
- Beside or below it: a small map card that zooms to the chosen city and drops a pin. A note: "Only the city is stored and visible to friends.".
- Buttons: "Back" (text) and "Continue" (disabled until a city is chosen).
- Step indicator "2 of 3".
- States: empty, typing with suggestions, no results ("We couldn't find that city. Check the spelling."), city selected.

SCREEN 3: Pick your bird (onboarding step 3 of 3)
- Heading "Choose your bird", subtext "You can change it any time.".
- A segmented toggle at top: "Origami" | "3D realistic".
- Grid of bird cards (3 columns on desktop, 2 on mobile), each with a 3D bird preview, name, and a one-line trait (for example "Arctic tern: loves coasts", "Crane: calm and steady", "Swallow: quick and light", "Pigeon: loyal home-finder", "Owl: night traveler"). Selected card has a sage outline and check mark.
- Below the grid a search field "Type a bird name" that filters the cards and, if the name matches a species, shows it as a card.
- A preview panel on the right (desktop) or bottom sheet (mobile) with a large rotatable 3D model of the selected bird and a name field "Name your bird".
- Buttons: "Back", and terracotta "Start flying".
- States: nothing selected, selected, search with no match ("No bird by that name yet.").

SCREEN 4: Dashboard (home base)
- Layout desktop: left two-thirds is a large soft 3D map or globe with the user's bird sitting at the home city pin; right third is a stack of cards.
- Greeting at top left: "Good morning, Azeem" and below it "Home base: Hyderabad".
- Timer card (right, top): large time "25:00", duration chips 15 / 25 / 45 / 60, a single text field "Where to?" with a search icon; live suggestions appear as the user types (place name, region, country, flag). Terracotta "Start flight" button. Under the button, a hint: "1 minute of focus = 100 km.".
- Current trip card (right, middle): destination name, a progress bar broken into segments (one per session), "42% of the way to Lisbon", distance left, and a button "Continue trip". Show the trip status badge: Outbound, Delivered, or Returning home (three colors: sky, sage, sand).
- Mailbox widget (right, lower): small illustrated mailbox with a red flag up and a badge count "3 letters waiting", button "Open mailbox".
- Travel activity strip (bottom of right column, or full width on mobile): four tiles with an icon each: Places visited, Countries stamped, Distance flown, Focus hours; plus a toggle "This week | This month | All time".
- Latest story: a small card showing the last landing with a thumbnail and place name, linking to Journal.
- Mobile: map on top at reduced height, timer card as a bottom sheet that can be pulled up, other cards stacked below.
- States: first time (no trips, friendly empty text "Where shall we go first?"), trip in progress, returning home, offline banner.

SCREEN 5: Focus session
- Full-screen 3D terrain map showing real land with soft colors. The bird flies near the center, with a fading trail behind it. The camera follows with a slight tilt. Place labels fade in and out softly as the bird passes.
- Small floating timer card at the top right: countdown (for example 18:42), destination, distance left, a thin progress ring, and a small "End flight" text button.
- A calm line at the bottom center: "Stay on this tab. Your bird is flying.".
- Optional tiny sound toggle at the bottom left.
- No other navigation visible.
- Mobile: timer card becomes a compact chip at the top right that expands on tap; the rest stays map only.
- States: flying, final minute (gentle pulse on the timer), arriving (bird descends).

SCREEN 6: Welcome back (after leaving the tab)
- The focus map is visible but dimmed behind a centered card.
- Card heading "Welcome back". Body: "You left at 11:42. Your bird rested near [place name]." A small map thumbnail marks the exact resting spot.
- A mini story preview (photo thumbnail and first line) and, if it is a new country, a stamp icon with "New stamp!".
- Stats row: distance covered so far, time focused so far.
- Buttons: terracotta "Resume flight" and secondary "Start a new one".
- Mobile: card is a bottom sheet.

SCREEN 7: Landing story card
- A beautiful full card shown when a flight ends. Left or top: a large photo of the place with rounded corners (or a soft illustration if no photo). Over the photo: a flag chip with the country.
- Content: place name in Fraunces, region and country below, a small label chip for the story type (Legend, Food, Hidden spot, Nature, History).
- A short story paragraph (about 80 words) in Nunito, readable line length.
- A "Birds seen near here" row with up to 3 small bird thumbnails and names.
- A "Source" link with a small book icon.
- Row of actions: sound icon (play a soft coo), "Save to journal" (heart/bookmark), "Share", and terracotta "Continue journey".
- If the country is new, a stamp animates in at the bottom corner with the text "New stamp collected".
- Three variants: with photo; without photo (illustration of a landscape); nature/wildlife variant with a species illustration.
- Mobile: full-screen sheet, photo on top, content scrolls.
```

---

## PART 2: Trips, friends, mailbox (screens 8 to 13)

```
SCREEN 8: New trip and letter composer
- Step layout (three steps with a progress header): 1 Bird, 2 Destination, 3 Letter.
- Step 1: show the current bird with a "Change bird" link.
- Step 2: a single text field "Where to?" with live suggestions (place, region, country, flag). Under it a toggle "A place | A friend". If "A friend" is chosen, show a list of friends with avatar, name, city, and radio selection. Show a route preview on a small map with the distance and the estimated focus time ("About 40 min of focus, in 2 sessions").
- Step 3 (optional letter, only when the destination is a friend): a paper-style composer. Fields: "To" (friend's name, locked), a large text area on lined paper with a handwriting font, an attach button (images, a PDF such as a CV, up to 5 MB) showing attachments as small chips with remove (x), a microphone button for voice dictation that fills the text, character counter, and a "Letter will be delivered when your bird arrives" note.
- Buttons: "Back", "Skip letter", terracotta "Start flight".
- States: no friend selected, file too large (error), dictation listening.

SCREEN 9: Friends list
- Header "Friends" with a button "Add a friend".
- Tabs: "Friends" and "Requests (2)".
- Friend row cards: avatar, name, home city with flag, last activity ("Flying to Lisbon"), and quick actions: "Send a letter" and a small map icon.
- When a friend's bird is on its way to the user, show a banner on that row: "Maya's bird is 2 hours of flying away" with a mini map showing the bird position and the line between them.
- Requests tab: incoming requests with Accept and Decline buttons, outgoing pending shown as "Waiting".
- Empty state: illustration of two birds on a branch, "No friends yet. Invite someone to send letters.".
- Search field to filter friends.

SCREEN 10: Add a friend
- Modal on desktop, full screen on mobile.
- Two options in tabs: "Invite link" and "Enter a code".
- Invite link: shows the user's personal link and an 8-character code in big type, with "Copy link", "Share" buttons, and a note "Friends can join with this link. You'll approve each request.".
- Enter a code: input for the code, "Find friend" button, then a result card (name, city) with "Send request".
- States: invalid code, request sent confirmation, already friends.

SCREEN 11: Mailbox (inbox)
- Page title "Mailbox".
- Top: an illustrated mailbox with the flag up if there are unopened letters.
- Below: a grid of closed envelopes in cream paper tones, each slightly rotated, with a wax-seal style dot, sender name, city, a postage stamp showing the sender's country flag, and the date delivered. Unopened envelopes have a small sage "New" tag. Opened ones look lighter.
- Filter pills: All, Unopened, Sent by me (letters you sent that are still traveling, shown as envelopes with a small bird icon and "In flight, arrives in 2 sessions").
- If the user's bird is returning home with replies, show a banner: "Your bird is coming home with 2 letters.".
- Empty state: an empty mailbox, "No letters yet.".
- Mobile: two-column grid.

SCREEN 12: Envelope opening (animation frames)
- Show the sequence as 4 storyboard frames in one screen layout, since Stitch cannot show motion: (1) the chosen envelope lifts and centers, with the rest of the inbox blurred; (2) the wax seal pops and the flap opens; (3) the letter slides up out of the envelope; (4) the letter unfolds to full size.
- Soft paper rustle sound icon indicator. A "Skip" link in the corner.

SCREEN 13: Opened letter
- A realistic sheet of paper on a wooden-grain or linen desk background (kept light). Paper has subtle texture, slightly uneven edges, and a faint shadow.
- Top of the letter: date and city ("Delhi, 12 June"). Body in a handwriting font with natural line spacing. Sign-off and sender name at the bottom.
- Attached images appear as photos with tape or pins slightly rotated. Attached files (PDF) appear as a paper-clipped card with file name and a Download button.
- A postage stamp and a postmark in the upper right corner showing the sender's country flag and the delivery date.
- Actions under the letter: "Reply" (opens the letter composer to this friend), "Save", "Close letter".
- Mobile: paper fills the screen and scrolls.
```

---

## PART 3: Passport, journal, settings (screens 14 to 18)

```
SCREEN 14: Passport
- Page title "Passport" and a short summary line: "14 countries, 31 places, 18,400 km".
- A passport-booklet look: a soft leather-style cover color (sage) at the top as a header banner, below it pages of stamps on cream paper.
- Stamps in a grid, each slightly rotated, with perforated edges and ink texture. Each stamp shows the country's flag, country name, and the date first visited. They should look decorative and original, not copies of any real government border stamps.
- Filters: All, This month, This year; sort: Newest, A to Z, Continent.
- A counter chip "14 of 195 countries".
- Locked stamps: faint outlines with a question mark for countries not yet visited, optionally hidden by a toggle "Show unvisited".
- Tap a stamp: small popover with the first-visit date and the number of visits, and a "View stories" link to the Journal filtered by that country.
- Button "Share stamps" opens Screen 15.
- Empty state: blank passport page, "Your first stamp is one flight away.".

SCREEN 15: Share stamps (Instagram)
- Modal with a live preview of a 1080x1350 share card on the left (desktop) or on top (mobile).
- The card: soft cream background, the bird logo at the top, title "My journeys" (or the chosen period), a stylized route map line across the world with dots for places, a collage of 4 to 9 chosen stamps, and a footer row with: countries visited, distance flown, focus hours, and the app name "Pigeon Post" with a small handle.
- Controls on the right: period picker (this week, this month, all time), checkboxes or multi-select to choose which stamps to show, a background color picker with four calm palettes, toggle "Show my name".
- Buttons: "Download image", "Share to Instagram", "Copy link".
- Format chips: Story (1080x1920), Post (1080x1350), Square (1080x1080).

SCREEN 16: Journal (story gallery)
- Page title "Journal", a subtext "Every place your bird has shown you.".
- Toolbar: search field, filter by country (dropdown with flags), filter by story type (Legend, Food, Hidden spot, Nature, History), sort (Newest, Oldest, Country).
- A scrapbook-style masonry grid of story cards. Each card: photo or illustration, place name, country flag, story type chip, date, a small bookmark if saved. Cards tilt very slightly and have washi-tape corners for a scrapbook feel.
- A "Saved" tab for bookmarked cards.
- A small sound icon on each card to replay the coo.
- Empty state: an open notebook with a pen, "Your journal starts with your first landing.".
- Mobile: single column, large cards.

SCREEN 17: Journal story detail
- Full page for one story card opened from the Journal.
- Large photo or illustration at the top, back arrow, place name, country with flag, story type chip, date visited, and the distance flown to get here.
- Full story text, "Birds seen near here" row, and a "Source" link.
- A small map showing the spot where the bird landed, with your route to it as a dotted line.
- Actions: sound toggle, Save, Share, "Fly here again" (starts a new trip with this place as the destination).
- Previous and next arrows to move through the journal.

SCREEN 18: Settings
- Left sidebar (desktop) or list (mobile) of sections: Profile, Home city, Birds, Sound, Notifications, Privacy, Account.
- Profile: avatar, display name, short bio field.
- Home city: the same city search as onboarding, with a warning "Changing it affects where your bird starts and returns.".
- Birds: shows the current bird with a 3D preview, toggle Origami or 3D realistic, a name field, and a "Change bird" button.
- Sound: master toggle, volume slider, toggle "Bird coo on landing", toggle "Paper rustle when opening letters", toggle "Flight ambience".
- Notifications: toggles for "A letter arrived", "A friend's bird is nearby", "Friend request", with a delivery option (email or in the browser).
- Privacy: note that only the city is shared; toggle "Let friends see my bird flying"; toggle "Show my stats to friends".
- Account: connected Google account, "Sign out", and a red-text "Delete my account" with a confirmation step.
- Save bar that appears when something changes: "Save changes" and "Cancel".
```

---

## Notes
- Item "legally certified stamps" was changed to decorative original stamps, since certification isn't possible and copying real border stamps could be a problem.
- "VPN activity" was read as travel activity (places visited, distance, focus hours).
- "Sound problem" was read as a sound feature with an on/off toggle.
