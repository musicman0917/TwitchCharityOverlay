# TwitchCharityOverlay

A cozy fantasy-tavern themed Twitch donothon overlay for **Dayton Children's Hospital**,
powered by an [Extra Life](https://www.extra-life.org/) / DonorDrive donation feed.

- **Backend**: Node.js, Express, Socket.io, Axios — polls the Extra Life API every 15s,
  tracks a donothon countdown timer, and pushes live updates to the browser overlay.
- **Frontend**: static HTML/CSS/vanilla JS overlay meant to be added as an OBS Browser Source
  (1920x1080), showing a countdown timer, donation goal bar, latest-donor callout, and an
  animated "new hero" alert popup.

## Setup

```bash
npm install
cp .env.example .env   # then edit .env and set a real ADMIN_PASSWORD
```

`.env` is gitignored — this repo is public, so never commit real secrets. `deploy.ps1`
creates `.env` from `.env.example` automatically on first install if it's missing.

## Local data files (donation sounds / asset images / zoo events)

`public/donation-tiers.json`, `public/asset-images.json`, and `zoo-events.json` are **not**
tracked in git — they're real data the admin portal mutates live on your server (sounds you've
uploaded, logos you've uploaded, the 9/17 zoo schedule you've entered), and tracking them would
mean any future code update could conflict with or overwrite what's actually running.

Each is seeded automatically from its committed `*.example.json` template
(`public/donation-tiers.example.json`, `public/asset-images.example.json`,
`zoo-events.example.json`) the first time `server.js` boots and finds it missing — after that,
it's purely local. To change the *shipped defaults* for a fresh install, edit the
`.example.json` file, not the live one.

(Milestones aren't part of this — they're pulled live from your Extra Life participant page's
Fundraiser Milestones instead of stored locally at all. See "Donation milestones" below.)

**If a `git pull` ever fails with "local changes would be overwritten" on one of these two
files** (shouldn't happen anymore now that they're gitignored, but if you're recovering from
before this change): back up the live file, let git have its way, restore your backup —
nothing is lost:

```powershell
Copy-Item public\donation-tiers.json public\donation-tiers.backup.json
git checkout -- public\donation-tiers.json
git pull origin claude/twitch-charity-subathon-overlay-qtwc8a
Copy-Item public\donation-tiers.backup.json public\donation-tiers.json -Force
pm2 restart nom-charity-overlay
```

(Swap in `public\asset-images.json` if the conflict is on that one instead.) The server
normalizes the sound file format on every boot regardless of which schema version your
restored file is in, so nothing needs to match exactly.

## Configuration

The server reads optional environment variables (all have sensible defaults except
`ADMIN_PASSWORD`, set via `.env` — see above):

| Variable              | Default                 | Description                                        |
|-----------------------|--------------------------|-----------------------------------------------------|
| `PORT`                | `3011`                   | Port the Express/Socket.io server listens on         |
| `PARTICIPANT_ID`      | `567118`                 | Extra Life / DonorDrive participant ID to track      |
| `GOAL_AMOUNT`         | `1000`                   | Donation goal shown on the goal bar (in dollars)     |
| `POLL_INTERVAL_MS`    | `15000`                  | How often to poll the Extra Life API (ms)            |
| `NOM_ALERTS_BASE_URL` | `http://localhost:3010`  | Base URL of the `nom-token-broker` server, used for theme sync (see below) |
| `ADMIN_PASSWORD`      | *(none)*                 | Password for the admin portal (`/admin.html`) — logins are rejected until this is set |
| `DISCORD_WEBHOOK_URL` | *(none)*                 | Discord webhook for donation announcements (see below) — leave unset to disable |
| `STARTING_HOURS`      | `4`                      | Base countdown duration in hours — only applies on the very first-ever boot (no `.overlay-state.json` yet); change it later via the admin portal instead (see below) |
| `DONATION_REMINDER_INTERVAL_MS` | `900000` (15 min) | How often the recurring donation-link chat reminder repeats while the timer is running (see "Chat announcements" below) |

## Deployment (streaming PC — alongside NOM Alerts)

This overlay is meant to run on the same Windows streaming PC as the `nom-token-broker`
pm2 process (port 3010), as its own independent pm2 app on **port 3011**, in a sibling
folder — it does not share any files or state with the Alerts app.

### First-time install

The repo isn't on the streaming PC yet, so bootstrap it by downloading and running
`deploy.ps1` directly from this branch (requires Git, Node.js, npm, and pm2 already on
PATH — same prerequisites `nom-token-broker` already needs):

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/musicman0917/TwitchCharityOverlay/claude/twitch-charity-subathon-overlay-qtwc8a/deploy.ps1" -OutFile "$env:TEMP\deploy.ps1"
powershell -ExecutionPolicy Bypass -File "$env:TEMP\deploy.ps1"
```

This clones the repo into `C:\Users\music\Documents\CharityOverlay\`, runs `npm install`,
and starts it with pm2 using `ecosystem.config.js` — registering it alongside
`nom-token-broker` as **`nom-charity-overlay`** on port **`3011`**. Check both are running
with `pm2 list`.

### Updating later

Once it's cloned, just re-run `deploy.ps1` from inside the checkout to pull the latest
changes and restart the pm2 process:

```powershell
cd C:\Users\music\Documents\CharityOverlay
.\deploy.ps1
```

### Persisting pm2 across reboots

Unlike Linux, `pm2 startup` isn't native on Windows. If you haven't already set this up for
the Alerts app, install [`pm2-windows-startup`](https://www.npmjs.com/package/pm2-windows-startup)
once:

```powershell
npm install -g pm2-windows-startup
pm2-startup install
pm2 save
```

(If this is already configured for `nom-token-broker`, `nom-charity-overlay` will be picked
up automatically the next time you `pm2 save`.)

This overlay is **localhost/LAN-only** — it is not added to the Cloudflare Tunnel, since the
OBS Browser Source loading it runs on the same PC.

To stop/restart just this app:

```powershell
pm2 restart nom-charity-overlay
pm2 stop nom-charity-overlay
pm2 logs nom-charity-overlay
```

## Adding the overlay to OBS

1. In OBS, add a **Browser Source**.
2. Set the URL to `http://localhost:3011`.
3. Set width `1920` and height `1080`.
4. Check "Shutdown source when not visible" **off**, so the timer keeps ticking in the
   backend regardless (the backend is authoritative — the browser source just displays it).
5. Refreshing the browser source is safe at any time: on connect, the server immediately
   sends the current timer, total raised, and latest donor so nothing resets.

## Vertical / mobile overlay

`http://localhost:3011/mobile.html` is a second overlay page for a portrait (9:16) OBS
scene — e.g. a vertical stream layout for TikTok/Instagram, or any scene where the
1920x1080 horizontal layout doesn't fit. It's driven by the exact same backend and
`script.js` as the main overlay (same Socket.io events, same donation tiers, milestones,
theme, and asset images), just re-laid-out: the Timer/Goal/Latest Hero panels stack
vertically instead of sitting side by side. Add it as a Browser Source the same way, but
set width `1080` and height `1920`.

## Clip-friendly layout

The bottom bar is deliberately **three separate panels** (Timer, Goal, Latest Hero) with real
gaps between them, not one continuous connected bar. Auto-clipping tools (e.g. StreamLadder)
crop a vertical 9:16 slice out of the 1920-wide frame — with everything joined into a single
bar, that crop could land mid-section and show a confusing, jaggedly-cropped fragment. With
separate panels, a crop either lands cleanly within one complete panel or in the transparent
gap between panels, never a half-cut connected edge. The Timer and Latest Hero panels are
narrow enough to often fit entirely within a typical crop; the Goal panel is wider (it needs
room for the progress bar) so a centered crop may still only show part of it, but as a clean
window into a solid card rather than a broken edge.

## How the donothon timer works

- The timer starts at a **base duration** (default 4 hours — set `STARTING_HOURS` before the
  first-ever boot, or change it later via the admin portal's "Base Timer Duration" control,
  which doesn't require picking a code default up front if you haven't decided yet). Every
  dollar donated adds **120 seconds** (2 minutes). On days when "Bonus Time" is toggled on in
  the admin portal (see Admin portal below), that jumps to **5 minutes** per dollar instead.
  Changing the base later doesn't touch the currently running countdown — it only changes what
  "Reset" returns it to; click Reset afterward if you want the new base to apply immediately.
- The server polls the Extra Life donations endpoint every 15 seconds. For every **new**
  donation it detects, it adds time and fires a `newDonation` alert on the overlay.
- Donations that already existed the first time the server successfully polls (e.g. donations
  made before you first started the overlay) are recorded as a baseline and do **not** add
  time — only donations that arrive *after* that first poll extend the clock.
- **State persists across restarts.** `currentTimer`, `totalRaised`, processed donation IDs,
  reached milestones, and the pause/schedule state all get written to `.overlay-state.json`
  (gitignored — it's runtime data, not source) after every meaningful change, plus every 10s
  as a safety net for the ticking countdown. A pm2 restart, crash, or PC reboot during a
  multi-week lead-up to a stream picks up right where it left off instead of losing donation
  time or re-baselining and silently swallowing donations that arrived while it was down.
- **Fresh installs default to paused.** `timerPaused` starts `true` when there's no
  `.overlay-state.json` yet, so the countdown never starts ticking on its own the moment you
  first deploy — donations still add time and the goal bar still updates while paused, only
  the countdown itself is frozen. Once resumed (manually via the admin portal, or by a
  schedule — see below), that running state is what persists across future restarts, so a
  restart *during* the actual stream won't re-pause it.
- **Scheduled auto-resume**: instead of remembering to click "Resume" at the exact moment the
  stream starts, set a date/time in the admin portal's Timer Controls panel and the server
  will flip `timerPaused` to `false` automatically at that moment (checked every tick, so it
  works correctly no matter how far in the future it is — a plain `setTimeout` can't handle
  delays longer than ~24.8 days). Manually resuming at any point cancels a pending schedule.

## Donation alert tiers + sound

Larger donations get a bigger, longer, more glowing "A New Hero Approaches!" alert, plus a
sound. Thresholds, per-tier duration, and each tier's sound files are configured in
`public/donation-tiers.json` (a purely client-side/presentational config — unlike milestones,
the backend doesn't need to know about tiers at all except when the admin portal is
adding/removing a sound):

```json
[
  { "id": "tier1", "label": "Small Donation", "minAmount": 1, "durationMs": 5000, "sounds": ["Assets/Sounds/donation-tier-1.mp3"] },
  { "id": "tier2", "label": "Medium Donation", "minAmount": 25, "durationMs": 6500, "sounds": ["Assets/Sounds/donation-tier-2.mp3"] },
  { "id": "tier3", "label": "Large Donation", "minAmount": 100, "durationMs": 8000, "sounds": ["Assets/Sounds/donation-tier-3.mp3"] }
]
```

- A donation's tier is whichever entry has the highest `minAmount` that's still ≤ the amount
  donated — edit the amounts/count/duration freely, no code changes needed.
- **Each tier can have multiple sounds** — `sounds` is an array of `{path, name}` objects
  (`name` is the original filename you uploaded, shown in the admin panel instead of the
  meaningless server-generated storage filename), and the overlay picks one at random every
  time an alert of that tier fires (`pickRandomSound()` in `public/script.js`). Manage them
  through the admin portal's **Donation Alert Sounds** panel: the file picker supports
  **selecting multiple files at once** (one upload click adds all of them in a single
  request), each sound has its own "▶ Play" preview and "Remove" button, and uploading never
  overwrites an existing sound (server-generated filename per file). Changes broadcast live to
  any open overlay via a `donationTiersUpdate` socket event — no restart or reload needed.
- **Sound files go in `public/Assets/Sounds/`** (see the README there) — until a tier has at
  least one sound, missing sounds fail silently (no console errors, no broken overlay), so
  it's safe to deploy before you have final audio.
- Visual escalation (bigger card, thicker gold border, stronger/pulsing glow, larger text) is
  fixed in `public/style.css` under the `.alert-box.tier2` / `.alert-box.tier3` rules — these
  aren't in the JSON since they're a design choice, not something you'd want to reconfigure
  per-stream. tier1 uses the base `.alert-box`/`.alert-scroll` styles.

## Shared theme (Tavern / Disney)

This overlay shares the same theme toggle as NOM Alerts (`admin.html`), which has two themes:
**Tavern** (default, amber/gold) and **Disney** (deep purple/gold — `body[data-theme="disney"]`
in `nom-alerts.html`). The confirmed contract, captured directly from `nom-token-broker`:

- `GET /theme-state` → `{"theme":"tavern"}` or `{"theme":"disney"}`
- SSE on `/alerts-stream` → `data: {"type":"theme-switch","theme":"<name>"}` (no `event:` field —
  every message is a plain `data:` line with a `type` discriminator)

How it's wired up:

- On startup, the charity overlay backend fetches the current theme from `/theme-state`.
- It then connects to `/alerts-stream` and listens for `theme-switch` messages, instantly
  re-broadcasting them to its own overlay clients over Socket.io (`themeUpdate`) — so flipping
  the theme in admin.html updates both overlays at the same time.
- If `nom-token-broker` isn't reachable (not started yet, wrong port, etc.), the charity
  overlay logs a warning, retries the SSE connection every 5 seconds, and falls back to the
  Tavern theme in the meantime — it never crashes or blocks on the Alerts app being up.
- The backend doesn't hardcode the two theme names — it just relays whatever `theme` value
  `nom-token-broker` reports. The frontend (`applyTheme()` in `public/script.js`) renders its
  Disney skin only when `theme === 'disney'`, and falls back to the Tavern look for anything
  else, so if NOM Alerts ever adds another theme this overlay won't get stuck — it'll just stay
  on Tavern until a matching skin is added to `public/style.css`.

If `NOM_ALERTS_BASE_URL` points somewhere unreachable, or you don't want theme sync at all,
the overlay just stays on Tavern — no configuration needed to disable it.

## Chat announcements

New donations and newly-crossed milestones get posted to Twitch chat automatically, via
`nom-token-broker`'s `POST /chat/announce` endpoint — same idea as theme sync: this overlay
has no Twitch credentials of its own, it just asks `nom-token-broker` (which already holds the
bot's OAuth token) to send the message. Nothing to configure beyond `NOM_ALERTS_BASE_URL`
already being set correctly.

- Donation: `🎉 $50 donation from CoolViewer! Thank you!`
- Milestone: `🏆 Milestone reached: $500 — Shave my head!`

Only *real* donations/milestones trigger this — the admin portal's Test Alerts never touch
chat, and the startup baseline catch-up (donations/milestones that already existed before the
overlay's first poll) is silent here too, same as it is for the on-overlay alerts. If
`nom-token-broker` is unreachable or rejects the request (e.g. its Twitch token expired), the
failure is logged and otherwise ignored — it never affects the timer or donation processing
that triggered it.

There's also a recurring reminder, every `DONATION_REMINDER_INTERVAL_MS` (default 15 minutes):

> 💝 Every dollar helps kids at Dayton Children's Hospital and adds time to the clock! Donate:
> https://dd.extra-life.org/participants/567118

It only fires while the Twitch stream is actually live — not while the donothon timer is
running. Live status comes from NOM Alerts via the same SSE connection as theme sync
(`nom-token-broker`'s `stream.online`/`stream.offline` EventSub subscriptions), with an initial
`GET /stream-status` fetch on boot so a restart mid-stream doesn't wait for the next status
event to figure out it's live:

- `GET /stream-status` → `{"live": true}` or `{"live": false}`
- SSE `/alerts-stream` → `data: {"type":"stream-status","live":true}` on change

During the multi-week lead-up before a stream, or any time the stream goes offline, this stays
silent instead of repeating into an empty chat — regardless of whether the donothon timer
itself is paused or running. Going live restarts the interval from zero, so the first reminder
lands a full interval after stream start, not immediately. The admin portal's Status panel
shows the current `Stream: LIVE`/`Offline` state live, same as it does for the theme.

## Discord donation announcements

Every real donation posts a rich embed to a Discord webhook, if `DISCORD_WEBHOOK_URL` is set
(see Configuration above) — this is entirely optional, and the overlay works exactly the same
without it. Unlike the NOM Alerts integrations above, this one needs its own secret: a Discord
webhook URL is a bearer credential (anyone who has it can post to that channel), so it's set
via `.env` and never committed, exactly like `ADMIN_PASSWORD`.

The embed escalates with the donation's tier (the same tiers already configured in
`public/donation-tiers.json` for the on-overlay alert — no separate configuration):

- **Tier 1** (small): `🎉 New Donation!`, gold
- **Tier 2** (medium): `🔥 Awesome Donation!`, orange
- **Tier 3** (large): `🌟 INCREDIBLE Donation!`, orange-red

Each embed includes the donor name and amount, a clickable title linking to the Extra Life
donation page, current total raised (amount + percent of goal), and how much time that
donation added to the timer. Only real donations trigger this — same baseline/test-alert
exclusions as the chat announcements above. A webhook failure (deleted webhook, Discord
outage, etc.) is logged and otherwise ignored, never affects the timer or donation processing.

## Donation milestones

Milestones aren't configured in this repo at all — they're pulled directly from your Extra
Life participant page's **Fundraiser Milestones** (`GET /api/participants/{id}/milestones`,
the DonorDrive API), the same feature that shows a "Pie in the face at $250!" style list on
your donation page. Set them up there (edit your participant page on extra-life.org) and the
overlay picks them up automatically — no code or file changes needed here.

The server re-fetches the list every 5 minutes (milestones don't change mid-stream, so there's
no need to poll as often as donations/totals), maps each one's `fundraisingGoal`/`description`
onto the same `{amount, label}` shape the overlay already used, and shows only the active
ones. The admin portal's "Fundraiser Incentives"-style **Milestones** panel is read-only —
it's just showing you what's live on your Extra Life page, not editing anything locally.

Each milestone shows up in two places:

- **Goal bar markers** — a small gold tick at the milestone's position along the donation goal
  bar, dim until reached.
- **"Next Milestone" callout** — a compact pill that pops in just above the goal bar every ~90
  seconds for ~8 seconds, showing whichever milestone hasn't been reached yet (amount + label).
  It's purely time-based, not tied to donation events, and shows nothing once every milestone
  has been reached. This replaced an earlier always-visible top-left panel to save screen space.
- **Full-screen alert** — a bigger, longer-lasting popup (8s vs. the donation alert's 5s) fires
  center-screen the moment a milestone is crossed, showing the amount and reward label.

Milestones are tracked against `totalRaised` (the same Extra Life total used for the goal bar),
checked every time it's polled (every `POLL_INTERVAL_MS`). If the server restarts mid-stream
with `totalRaised` already past some milestones, those are marked reached silently on the first
check — only milestones crossed *after* that get the full-screen alert, so a restart doesn't
replay a pile of alerts for progress that already happened.

Milestone amounts are independent of `GOAL_AMOUNT` — the goal bar always scales to
`GOAL_AMOUNT`, so a milestone set above it will show its marker pinned at the right edge.

## Zoo events (9/17 birthday stream only)

The Cincinnati Zoo has no public schedule API, so this one really is a locally-edited list —
unlike milestones/incentives above. Enter that day's showtimes (time + name) in the admin
portal's **Zoo Events** panel, then flip on the **Enable Zoo Events** toggle only during the
zoo segment of the stream (turn it back off afterward). While on, a "Next At The Zoo" callout
pops in every ~90 seconds for ~8 seconds — same cadence as "Next Milestone," just showing
whichever zoo event is coming up next by the clock instead of a donation amount. Shows nothing
if the toggle is off, or once every event for the day has already passed. Appears on both the
main overlay and the vertical/mobile overlay.

## Admin portal

`http://localhost:3011/admin.html` is a control panel for running the overlay during a
stream, gated behind `ADMIN_PASSWORD` (set in `.env`, see Setup above). It's a separate
static page, not linked from the overlay itself.

**Trust model:** simple shared-password auth, same spirit as `nom-token-broker`'s
`admin.html` — no rate limiting, no per-user accounts, sessions are random in-memory
tokens that reset on server restart. This is fine for **localhost/LAN-only** use (the
overlay is never added to the Cloudflare Tunnel) but is **not** hardened for internet
exposure. Don't port-forward 3011 or add it to the tunnel.

What it can do:

- **Timer controls** — set the base timer duration (hours), pause/resume the countdown, nudge
  it by ±1/±10 minutes or a custom number of seconds, reset to the base duration, or schedule
  an exact date/time for it to auto-resume (handy for a stream announced weeks out — see "How
  the donothon timer works" above). A paused timer shows a "⏸ PAUSED" indicator, and the
  bottom quest board itself shrinks down to just the timer and goal bar (dropping "Latest
  Hero" and the milestone tick marks) — it's meant to sit paused for days/weeks before a
  stream without eating screen space the whole time, then expands back to full size the
  moment it starts running.
- **Test alerts** — fire a donation alert (any name/amount, exercises the tier system) or a
  milestone alert (any amount/label) on demand. These are visual/audio previews only — they
  never touch the real timer, `totalRaised`, or the "Latest Hero" display, so testing mid-stream
  is safe.
- **Milestones panel** — read-only. Shows whatever Fundraiser Milestones are currently live on
  your Extra Life participant page (see "Donation milestones" above); to change amounts/reward
  text, edit them there, not here.
- **Sound upload** — add or remove donation alert sounds per tier directly from the browser,
  each with a play-preview button; the overlay picks one at random per alert (see "Donation
  alert tiers + sound" above). Takes effect immediately, no restart needed.
- **Asset images** — upload the QR code and logo images for the top-right overlay boxes (see
  "Asset images" above), same immediate-effect, no-restart pattern.

All of this is backed by a small `/admin/*` API in `server.js`, protected by
`requireAdminAuth` (checks a `Bearer <token>` header issued by `POST /admin/login`) on every
route except the login itself. File uploads are validated (audio/image mimetype, size limits)
and always written to a server-controlled path derived from `donation-tiers.json` — the
uploaded filename and the `tier` field are never used to build a filesystem path, so there's
no path-traversal risk from a malformed request.

## Asset images (QR code + logos)

The top-right corner has three boxes — "QR Code", "Extra Life Logo", "Dayton Children's
Logo" — dashed-border placeholders until you upload real images through the admin portal's
**Asset Images** panel (PNG, JPEG, GIF, WebP, or SVG). Once uploaded, a box switches to a
solid border, shows the image, and drops its placeholder label — takes effect immediately on
any open overlay via a live socket update, no restart or reload needed.

This works the same way as donation alert sound uploads: `public/asset-images.json` maps
each box's id to its uploaded file path (`null` until something's uploaded), the unauthenticated
overlay fetches that manifest client-side to know what to display, and the upload endpoint
resolves the destination filename entirely from the known asset id (never from the uploaded
file's name or arbitrary request input), so there's no path-traversal risk. Re-uploading a
different format for the same box (e.g. swapping a `.png` for a `.svg`) automatically removes
the old file instead of leaving stale duplicates around.
