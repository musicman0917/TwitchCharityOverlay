const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3011;
const PARTICIPANT_ID = process.env.PARTICIPANT_ID || '567118';
const GOAL_AMOUNT = Number(process.env.GOAL_AMOUNT || 1000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);
const STARTING_SECONDS = 4 * 60 * 60; // 04:00:00
const SECONDS_PER_DOLLAR = 60; // +1 minute per $1 donated

// NOM Alerts (nom-token-broker) theme sync — shares the Tavern/Purple theme
// toggle that's controlled from admin.html on the Alerts overlay.
const NOM_ALERTS_BASE_URL = process.env.NOM_ALERTS_BASE_URL || 'http://localhost:3010';
const NOM_ALERTS_SSE_URL = `${NOM_ALERTS_BASE_URL}/alerts-stream`;
const NOM_ALERTS_THEME_STATE_URL = `${NOM_ALERTS_BASE_URL}/theme-state`;
const VALID_THEMES = new Set(['tavern', 'purple']);
const SSE_RECONNECT_DELAY_MS = 5000;

const PARTICIPANT_URL = `https://extra-life.org/api/participants/${PARTICIPANT_ID}`;
const DONATIONS_URL = `https://extra-life.org/api/participants/${PARTICIPANT_ID}/donations`;

const donorDriveClient = axios.create({
  timeout: 10000,
  headers: { 'User-Agent': 'TwitchCharityOverlay/1.0 (OBS Subathon Timer)' },
});

const nomAlertsClient = axios.create({
  timeout: 5000,
  headers: { 'User-Agent': 'TwitchCharityOverlay/1.0 (OBS Subathon Timer)' },
});

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
const state = {
  currentTimer: STARTING_SECONDS,
  totalRaised: 0,
  goal: GOAL_AMOUNT,
  latestDonorName: null,
  latestDonorAmount: null,
  processedDonationIds: new Set(),
  hasBaseline: false, // becomes true after the first successful donations poll
  theme: 'tavern',
};

// ---------------------------------------------------------------------------
// App / server setup
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve overlay assets with no-cache headers so OBS Browser Source refreshes
// always pick up the latest files instead of serving a stale cached copy.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  },
}));

io.on('connection', (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);
  // Send full current state immediately so a fresh/refreshed browser source
  // does not reset the timer or goal bar.
  socket.emit('state', serializeState());
});

function serializeState() {
  return {
    currentTimer: state.currentTimer,
    totalRaised: state.totalRaised,
    goal: state.goal,
    latestDonorName: state.latestDonorName,
    latestDonorAmount: state.latestDonorAmount,
    theme: state.theme,
  };
}

function setTheme(theme) {
  if (!VALID_THEMES.has(theme) || theme === state.theme) return;
  state.theme = theme;
  console.log(`[theme] switched to "${theme}"`);
  io.emit('themeUpdate', { theme: state.theme });
}

// ---------------------------------------------------------------------------
// Subathon timer tick (broadcast every second)
// ---------------------------------------------------------------------------
setInterval(() => {
  if (state.currentTimer > 0) {
    state.currentTimer -= 1;
    if (state.currentTimer < 0) state.currentTimer = 0;
  }
  io.emit('timerTick', { currentTimer: state.currentTimer });
}, 1000);

// ---------------------------------------------------------------------------
// Extra Life / DonorDrive polling
// ---------------------------------------------------------------------------
async function pollTotalRaised() {
  try {
    const { data } = await donorDriveClient.get(PARTICIPANT_URL);
    if (typeof data.sumDonations === 'number') {
      state.totalRaised = data.sumDonations;
      io.emit('totalUpdate', { totalRaised: state.totalRaised, goal: state.goal });
    }
  } catch (err) {
    console.error('[poll] failed to fetch participant total:', err.message);
  }
}

async function pollDonations() {
  try {
    const { data } = await donorDriveClient.get(DONATIONS_URL);
    const donations = Array.isArray(data) ? data : [];

    // On the very first successful poll, treat all existing donations as
    // already-known history so we don't retroactively add hours to the
    // timer for donations that came in before the overlay started.
    if (!state.hasBaseline) {
      for (const donation of donations) {
        if (donation.donationID != null) {
          state.processedDonationIds.add(donation.donationID);
        }
      }
      state.hasBaseline = true;
      return;
    }

    // Sort oldest -> newest so timer additions and "latest donor" land in
    // chronological order when multiple donations arrive between polls.
    const sorted = [...donations].sort(
      (a, b) => new Date(a.createdDateUTC) - new Date(b.createdDateUTC)
    );

    for (const donation of sorted) {
      const id = donation.donationID;
      if (id == null || state.processedDonationIds.has(id)) continue;

      state.processedDonationIds.add(id);

      const amount = Number(donation.amount) || 0;
      const name = donation.displayName && donation.displayName.trim()
        ? donation.displayName.trim()
        : 'Anonymous';

      const secondsToAdd = Math.floor(amount) * SECONDS_PER_DOLLAR;
      state.currentTimer += secondsToAdd;

      state.latestDonorName = name;
      state.latestDonorAmount = amount;

      console.log(`[donation] ${name} donated $${amount.toFixed(2)} (+${secondsToAdd}s)`);

      io.emit('newDonation', { name, amount });
      io.emit('timerTick', { currentTimer: state.currentTimer });
    }
  } catch (err) {
    console.error('[poll] failed to fetch donations:', err.message);
  }
}

async function pollExtraLife() {
  await Promise.all([pollTotalRaised(), pollDonations()]);
}

// Kick off an initial poll immediately, then repeat on the interval.
pollExtraLife();
setInterval(pollExtraLife, POLL_INTERVAL_MS);

// ---------------------------------------------------------------------------
// NOM Alerts theme sync — live via SSE from nom-token-broker's /alerts-stream,
// with an initial fetch from /theme-state so we start on the right theme
// instead of always booting into "tavern".
//
// NOTE: the exact event name / payload shape nom-token-broker uses for theme
// changes wasn't available when this was written, so handleSseMessage()
// checks a few reasonable shapes. If the real broadcast looks different,
// adjust handleSseMessage() and fetchInitialTheme() below to match it.
// ---------------------------------------------------------------------------
async function fetchInitialTheme() {
  try {
    const { data } = await nomAlertsClient.get(NOM_ALERTS_THEME_STATE_URL);
    const theme = data && (data.theme || data.currentTheme);
    if (typeof theme === 'string' && VALID_THEMES.has(theme)) {
      state.theme = theme;
      console.log(`[theme] initial theme from NOM Alerts: "${theme}"`);
    }
  } catch (err) {
    console.warn(
      `[theme] could not fetch initial theme from NOM Alerts (${err.message}); defaulting to "${state.theme}"`
    );
  }
}

function handleSseMessage(raw) {
  if (!raw.trim()) return;

  let eventName = 'message';
  const dataLines = [];

  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }

  const rawData = dataLines.join('\n');
  if (!rawData) return;

  let payload;
  try {
    payload = JSON.parse(rawData);
  } catch {
    return; // not JSON, ignore
  }

  const candidateTheme =
    (eventName === 'theme' && payload.theme) ||
    (payload.type === 'theme' && payload.theme) ||
    payload.theme;

  if (typeof candidateTheme === 'string' && VALID_THEMES.has(candidateTheme)) {
    setTheme(candidateTheme);
  }
}

function connectToAlertsThemeStream() {
  axios
    .get(NOM_ALERTS_SSE_URL, {
      responseType: 'stream',
      timeout: 0,
      headers: { Accept: 'text/event-stream' },
    })
    .then((response) => {
      console.log(`[theme] connected to NOM Alerts SSE stream at ${NOM_ALERTS_SSE_URL}`);
      let buffer = '';

      response.data.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const messages = buffer.split('\n\n');
        buffer = messages.pop(); // keep trailing partial message for next chunk
        for (const raw of messages) handleSseMessage(raw);
      });

      response.data.on('end', () => {
        console.warn('[theme] NOM Alerts SSE stream ended; reconnecting in 5s');
        setTimeout(connectToAlertsThemeStream, SSE_RECONNECT_DELAY_MS);
      });

      response.data.on('error', (err) => {
        console.error(`[theme] NOM Alerts SSE stream error: ${err.message}; reconnecting in 5s`);
        setTimeout(connectToAlertsThemeStream, SSE_RECONNECT_DELAY_MS);
      });
    })
    .catch((err) => {
      console.warn(
        `[theme] could not connect to NOM Alerts SSE stream (${err.message}); retrying in 5s`
      );
      setTimeout(connectToAlertsThemeStream, SSE_RECONNECT_DELAY_MS);
    });
}

fetchInitialTheme().then(connectToAlertsThemeStream);

// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`Twitch Charity Overlay server listening on http://localhost:${PORT}`);
  console.log(`Tracking Extra Life participant ${PARTICIPANT_ID}, goal $${GOAL_AMOUNT}`);
});
