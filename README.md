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

1. On the streaming PC, clone (or `git pull` to update) this repo into:
   ```
   C:\Users\music\Documents\CharityOverlay\
   ```
2. Install dependencies:
   ```powershell
   cd C:\Users\music\Documents\CharityOverlay
   npm install
   ```
3. Start it with pm2 using the included `ecosystem.config.js` (sets the app name and
   port for you — no flags to remember):
   ```powershell
   pm2 start ecosystem.config.js
   pm2 save
   ```
   This registers it alongside `nom-token-broker` as `nom-charity-overlay` on port `3011`.
   Check both are running with:
   ```powershell
   pm2 list
   ```
4. Persisting pm2 across PC reboots on Windows: unlike Linux, `pm2 startup` isn't native
   here. If you haven't already set this up for the Alerts app, install
   [`pm2-windows-startup`](https://www.npmjs.com/package/pm2-windows-startup) once:
   ```powershell
   npm install -g pm2-windows-startup
   pm2-startup install
   pm2 save
   ```
   (If this is already configured for `nom-token-broker`, `nom-charity-overlay` will be
   picked up automatically the next time you `pm2 save`.)
5. This overlay is **localhost/LAN-only** — it is not added to the Cloudflare Tunnel, since
   the OBS Browser Source loading it runs on the same PC.

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

## Shared theme (Tavern / Purple)

This overlay shares the same Tavern/Purple theme toggle as NOM Alerts, controlled from
`admin.html` on the Alerts app:

- On startup, the charity overlay backend fetches the current theme from `nom-token-broker`'s
  `GET /theme-state` endpoint.
- It then connects to `nom-token-broker`'s `/alerts-stream` SSE feed and listens for theme
  change events, instantly re-broadcasting them to its own overlay clients over Socket.io
  (`themeUpdate`) — so flipping the theme in admin.html updates both overlays at the same time.
- If `nom-token-broker` isn't reachable (not started yet, wrong port, etc.), the charity
  overlay logs a warning, retries the SSE connection every 5 seconds, and falls back to the
  Tavern theme in the meantime — it never crashes or blocks on the Alerts app being up.

**Note:** the exact SSE event name/payload `nom-token-broker` uses for theme changes wasn't
available when this was built, so `handleSseMessage()` and `fetchInitialTheme()` in
`server.js` accept a few reasonable shapes (`event: theme` with `{"theme":"purple"}`,
`{"type":"theme","theme":"purple"}`, or a flat `{"theme":"purple"}`/`{"currentTheme":"purple"}`
field). If the live sync doesn't pick up theme changes, check your actual `/theme-state`
response shape and SSE event format and adjust those two functions to match — everything
else (the CSS variables, the `themeUpdate` Socket.io broadcast, the frontend `data-theme`
toggle) is already wired up and tested against both themes.

If `NOM_ALERTS_BASE_URL` points somewhere unreachable, or you don't want theme sync at all,
the overlay just stays on Tavern — no configuration needed to disable it.

## Asset placeholders

The top-right corner of the overlay has three dashed-border placeholder boxes for "QR Code",
"Extra Life Logo", and "Dayton Children's Logo". Swap them for real images by editing
`public/index.html`/`public/style.css` (e.g. give each box a `background-image`).
