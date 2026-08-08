# TwitchCharityOverlay

A cozy fantasy-tavern themed Twitch subathon overlay for **Dayton Children's Hospital**,
powered by an [Extra Life](https://www.extra-life.org/) / DonorDrive donation feed.

- **Backend**: Node.js, Express, Socket.io, Axios — polls the Extra Life API every 15s,
  tracks a subathon countdown timer, and pushes live updates to the browser overlay.
- **Frontend**: static HTML/CSS/vanilla JS overlay meant to be added as an OBS Browser Source
  (1920x1080), showing a countdown timer, donation goal bar, latest-donor callout, and an
  animated "new hero" alert popup.

## Setup

```bash
npm install
```

## Configuration

The server reads optional environment variables (all have sensible defaults):

| Variable              | Default                 | Description                                        |
|-----------------------|--------------------------|-----------------------------------------------------|
| `PORT`                | `3011`                   | Port the Express/Socket.io server listens on         |
| `PARTICIPANT_ID`      | `567118`                 | Extra Life / DonorDrive participant ID to track      |
| `GOAL_AMOUNT`         | `1000`                   | Donation goal shown on the goal bar (in dollars)     |
| `POLL_INTERVAL_MS`    | `15000`                  | How often to poll the Extra Life API (ms)            |
| `NOM_ALERTS_BASE_URL` | `http://localhost:3010`  | Base URL of the `nom-token-broker` server, used for theme sync (see below) |

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

## How the subathon timer works

- The timer starts at **04:00:00** when the server process starts and counts down every second.
- The server polls the Extra Life donations endpoint every 15 seconds. For every **new**
  donation it detects, it adds **60 seconds per $1 donated** to the timer and fires a
  `newDonation` alert on the overlay.
- Donations that already existed the first time the server successfully polls (e.g. donations
  made before you started the overlay) are recorded as a baseline and do **not** add time —
  only donations that arrive *after* the server starts will extend the clock.
- State (timer, total raised, processed donation IDs) lives in memory only and resets if the
  server process restarts — pm2 keeps the process alive so this should only happen on
  intentional restarts or crashes.

## Donation alert tiers + sound

Larger donations get a bigger, longer, more glowing "A New Hero Approaches!" alert, plus a
distinct sound. Thresholds, per-tier duration, and sound file paths are configured in
`public/donation-tiers.json` (a purely client-side/presentational config — unlike
`milestones.json`, the backend doesn't need to know about tiers at all):

```json
[
  { "id": "tier1", "label": "Small Donation", "minAmount": 1, "durationMs": 5000, "sound": "Assets/Sounds/donation-tier-1.mp3" },
  { "id": "tier2", "label": "Medium Donation", "minAmount": 25, "durationMs": 6500, "sound": "Assets/Sounds/donation-tier-2.mp3" },
  { "id": "tier3", "label": "Large Donation", "minAmount": 100, "durationMs": 8000, "sound": "Assets/Sounds/donation-tier-3.mp3" }
]
```

- A donation's tier is whichever entry has the highest `minAmount` that's still ≤ the amount
  donated — edit the amounts/count/duration freely, no code changes needed.
- **Sound files go in `public/Assets/Sounds/`** (see the README there) — until you drop real
  files in, missing sounds fail silently (no console errors, no broken overlay), so it's safe
  to deploy before you have final audio.
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

## Donation milestones

Milestones are configured in `milestones.json` (repo root) — edit this file whenever you want
to change the amounts or reward text, no code changes needed:

```json
[
  { "amount": 250, "label": "Milestone reward TBD" },
  { "amount": 500, "label": "Milestone reward TBD" },
  { "amount": 750, "label": "Milestone reward TBD" },
  { "amount": 1000, "label": "Goal Reached!" }
]
```

Placeholder amounts/labels are already in there — replace them with your real milestones
(e.g. `"Shave my head!"`, `"Extra hour on the timer"`) any time, then `pm2 restart
nom-charity-overlay` (or re-run `deploy.ps1`) to pick up the change.

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

## Asset placeholders

The top-right corner of the overlay has three dashed-border placeholder boxes for "QR Code",
"Extra Life Logo", and "Dayton Children's Logo". Swap them for real images by editing
`public/index.html`/`public/style.css` (e.g. give each box a `background-image`).
