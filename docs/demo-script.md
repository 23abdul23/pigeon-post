# Fost: two-device demo

About 10 minutes. You need the deployed site (`SiteUrl`), a laptop and a phone (or two browsers, one in a private window), and two Google accounts (A and B). Keep a terminal open for the optional data check (runbook, "Confirm data is saved").

1. **Laptop, sign in** with Google account A. A new account goes to onboarding.
2. **Home town by name**: on "Where is home?", type a small town (for example `Samobor`). Results show region and country; pick it. To show the map picker, tap **Pick on map**, tap near the town, and **Confirm**: home stays city level (coordinates are rounded to 2 decimals).
3. **Choose a bird**, then on Home open the **Trip Composer** (`/trip/new`), search a destination (a town, a landmark, or **Pick on map**) and start the flight. The Focus screen shows the bird moving; the Header chip disappears once everything is saved.
4. **Phone, sign in** with account A on the same site. It restores the bird, home and trip, and Focus shows the flight as **Flying on your other device**, with the same distance as the laptop (both use the server clock).
5. **Take over** on the phone. The laptop turns into the observer within its next heartbeat (30 s) or refresh.
6. **Land**: let the flight finish on the phone (or end it early). The landing card shows the story and, the first time in a country, a new stamp.
7. **Check both**: on each device open **Journal** (`/journal`) and **Passport** (`/passport`), refreshing the laptop if needed: one journal entry and one stamp on both, never two.
8. **Switch accounts**: on the laptop, Settings > **Sign out**, then sign in with account B. The laptop is a clean device for B (onboarding again, none of A's data shown or uploaded). Sign out and back in as A: everything comes back from the server.

If the chip shows **Offline** or **Sync problem**, see the runbook, "Sync troubleshooting". A stuck flight: runbook, "Reset a stuck flight".
