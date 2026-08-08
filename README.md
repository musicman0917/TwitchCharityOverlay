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

| Variable            | Default    | Description                                      |
|----------------------|-----------|---------------------------------------------------|
| `PORT`               | `3000`    | Port the Express/Socket.io server listens on      |
| `PARTICIPANT_ID`     | `567118`  | Extra Life / DonorDrive participant ID to track    |
| `GOAL_AMOUNT`        | `1000`    | Donation goal shown on the goal bar (in dollars)   |
| `POLL_INTERVAL_MS`   | `15000`   | How often to poll the Extra Life API (ms)          |

## Running with pm2

```bash
npm install -g pm2   # if you don't already have pm2
pm2 start server.js --name twitch-charity-overlay
pm2 save             # persist across reboots
pm2 logs twitch-charity-overlay   # tail logs
```

To stop/restart:

```bash
pm2 restart twitch-charity-overlay
pm2 stop twitch-charity-overlay
```

## Adding the overlay to OBS

1. In OBS, add a **Browser Source**.
2. Set the URL to `http://localhost:3000`.
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

## Asset placeholders

The top-right corner of the overlay has three dashed-border placeholder boxes for "QR Code",
"Extra Life Logo", and "Dayton Children's Logo". Swap them for real images by editing
`public/index.html`/`public/style.css` (e.g. give each box a `background-image`).
