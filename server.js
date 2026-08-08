require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const multer = require('multer');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3011;
const PARTICIPANT_ID = process.env.PARTICIPANT_ID || '567118';
const GOAL_AMOUNT = Number(process.env.GOAL_AMOUNT || 1000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);
const STARTING_SECONDS = 4 * 60 * 60; // 04:00:00
const SECONDS_PER_DOLLAR = 60; // +1 minute per $1 donated

// NOM Alerts (nom-token-broker) theme sync — shares whatever theme is
// selected from admin.html on the Alerts overlay. NOM Alerts supports more
// themes than this overlay has skins for (e.g. "disney"); the frontend only
// has a dedicated look for "purple" and falls back to the Tavern default for
// every other theme name, so the backend just relays whatever it's told.
const NOM_ALERTS_BASE_URL = process.env.NOM_ALERTS_BASE_URL || 'http://localhost:3010';
const NOM_ALERTS_SSE_URL = `${NOM_ALERTS_BASE_URL}/alerts-stream`;
const NOM_ALERTS_THEME_STATE_URL = `${NOM_ALERTS_BASE_URL}/theme-state`;
const SSE_RECONNECT_DELAY_MS = 5000;

// Admin portal — simple shared-password auth. Not meant for internet
// exposure: this stays on port 3011, localhost/LAN-only, never on the
// Cloudflare Tunnel. See README for the trust model.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) {
  console.warn(
    '[admin] ADMIN_PASSWORD is not set — the admin portal will reject all logins until it is configured.'
  );
}

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
// Donation milestones — placeholder amounts/labels, edit milestones.json to
// set the real ones. Sorted ascending so goal-bar markers and the milestone
// track render in order.
// ---------------------------------------------------------------------------
const MILESTONES_FILE = path.join(__dirname, 'milestones.json');
const DONATION_TIERS_FILE = path.join(__dirname, 'public', 'donation-tiers.json');
const SOUNDS_DIR = path.join(__dirname, 'public', 'Assets', 'Sounds');

function loadMilestones() {
  try {
    const raw = fs.readFileSync(MILESTONES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('milestones.json must be a JSON array');
    return parsed
      .filter((m) => typeof m.amount === 'number' && typeof m.label === 'string')
      .sort((a, b) => a.amount - b.amount);
  } catch (err) {
    console.warn(`[milestones] could not load milestones.json (${err.message}); no milestones configured`);
    return [];
  }
}

let milestones = loadMilestones();

// Overwrites milestones.json, reloads the in-memory list, and recomputes
// which ones count as "reached" against the current total — silently, like
// the startup baseline, since an admin edit isn't a real donation crossing
// and shouldn't fire alerts.
function saveMilestones(newMilestones) {
  const cleaned = newMilestones
    .filter((m) => typeof m.amount === 'number' && m.amount > 0 && typeof m.label === 'string' && m.label.trim())
    .map((m) => ({ amount: m.amount, label: m.label.trim() }))
    .sort((a, b) => a.amount - b.amount);

  fs.writeFileSync(MILESTONES_FILE, JSON.stringify(cleaned, null, 2) + '\n');
  milestones = cleaned;

  state.reachedMilestones = new Set(
    milestones.filter((m) => state.totalRaised >= m.amount).map((m) => m.amount)
  );

  console.log(`[milestones] admin updated milestones.json (${milestones.length} milestone(s))`);
  io.emit('milestonesUpdate', { milestones: serializeMilestones() });
  return milestones;
}

function loadDonationTiers() {
  try {
    const raw = fs.readFileSync(DONATION_TIERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('donation-tiers.json must be a JSON array');
    return parsed;
  } catch (err) {
    console.warn(`[admin] could not read donation-tiers.json (${err.message})`);
    return [];
  }
}

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
  reachedMilestones: new Set(), // amounts already crossed
  milestonesChecked: false, // becomes true after the first milestone check
  timerPaused: false,
};

// ---------------------------------------------------------------------------
// App / server setup
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

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
    milestones: serializeMilestones(),
    timerPaused: state.timerPaused,
  };
}

function serializeMilestones() {
  return milestones.map((m) => ({
    amount: m.amount,
    label: m.label,
    reached: state.reachedMilestones.has(m.amount),
  }));
}

function setTheme(theme) {
  if (typeof theme !== 'string' || !theme || theme === state.theme) return;
  state.theme = theme;
  console.log(`[theme] switched to "${theme}"`);
  io.emit('themeUpdate', { theme: state.theme });
}

// Checks totalRaised against the configured milestones and fires alerts for
// any newly-crossed ones. On the very first check (server just started, and
// totalRaised may already be well past some milestones from before the
// overlay was running), those get marked reached silently instead of firing
// a pile of alerts on startup.
function checkMilestones() {
  const isFirstCheck = !state.milestonesChecked;
  state.milestonesChecked = true;

  const newlyReached = [];
  for (const m of milestones) {
    if (state.totalRaised >= m.amount && !state.reachedMilestones.has(m.amount)) {
      state.reachedMilestones.add(m.amount);
      newlyReached.push(m);
    }
  }
  if (!newlyReached.length) return;

  if (isFirstCheck) {
    console.log(
      `[milestones] baseline: $${state.totalRaised} already covers ${newlyReached.map((m) => `$${m.amount}`).join(', ')}`
    );
    return;
  }

  for (const m of newlyReached) {
    console.log(`[milestone] reached $${m.amount}: ${m.label}`);
    io.emit('milestoneReached', { amount: m.amount, label: m.label });
  }
  io.emit('milestonesUpdate', { milestones: serializeMilestones() });
}

// ---------------------------------------------------------------------------
// Subathon timer tick (broadcast every second)
// ---------------------------------------------------------------------------
setInterval(() => {
  if (!state.timerPaused && state.currentTimer > 0) {
    state.currentTimer -= 1;
    if (state.currentTimer < 0) state.currentTimer = 0;
  }
  io.emit('timerTick', { currentTimer: state.currentTimer, timerPaused: state.timerPaused });
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
      checkMilestones();
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
// Confirmed contract (captured directly from nom-token-broker):
//   GET /theme-state  -> {"theme":"<name>"}
//   SSE /alerts-stream -> data: {"type":"theme-switch","theme":"<name>"}
//   (no `event:` field — every message is a plain `data:` line with a
//   `type` discriminator)
// ---------------------------------------------------------------------------
async function fetchInitialTheme() {
  try {
    const { data } = await nomAlertsClient.get(NOM_ALERTS_THEME_STATE_URL);
    if (data && typeof data.theme === 'string' && data.theme) {
      state.theme = data.theme;
      console.log(`[theme] initial theme from NOM Alerts: "${state.theme}"`);
    }
  } catch (err) {
    console.warn(
      `[theme] could not fetch initial theme from NOM Alerts (${err.message}); defaulting to "${state.theme}"`
    );
  }
}

function handleSseMessage(raw) {
  if (!raw.trim()) return;

  const dataLines = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());

  const rawData = dataLines.join('\n');
  if (!rawData) return;

  let payload;
  try {
    payload = JSON.parse(rawData);
  } catch {
    return; // not JSON, ignore
  }

  if (payload.type === 'theme-switch') {
    setTheme(payload.theme);
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
// Admin portal API — timer controls, sound upload, test alerts, milestone
// editing. Gated behind a shared password (ADMIN_PASSWORD env var); tokens
// are random, in-memory, and lost on restart (re-login required). Not meant
// for internet exposure -- see README.
// ---------------------------------------------------------------------------
const adminTokens = new Set();
const soundUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function passwordMatches(candidate) {
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a); // keep timing roughly constant either way
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/admin/login', (req, res) => {
  const password = req.body && req.body.password;
  if (!ADMIN_PASSWORD || typeof password !== 'string' || !passwordMatches(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.add(token);
  res.json({ token });
});

app.post('/admin/logout', requireAdminAuth, (req, res) => {
  const token = req.headers.authorization.slice('Bearer '.length);
  adminTokens.delete(token);
  res.json({ ok: true });
});

app.get('/admin/state', requireAdminAuth, (req, res) => {
  res.json(serializeState());
});

// -- Timer controls --
app.post('/admin/timer/pause', requireAdminAuth, (req, res) => {
  state.timerPaused = true;
  io.emit('timerTick', { currentTimer: state.currentTimer, timerPaused: state.timerPaused });
  res.json({ ok: true, timerPaused: state.timerPaused });
});

app.post('/admin/timer/resume', requireAdminAuth, (req, res) => {
  state.timerPaused = false;
  io.emit('timerTick', { currentTimer: state.currentTimer, timerPaused: state.timerPaused });
  res.json({ ok: true, timerPaused: state.timerPaused });
});

app.post('/admin/timer/adjust', requireAdminAuth, (req, res) => {
  const seconds = Number(req.body && req.body.seconds);
  if (!Number.isFinite(seconds)) {
    return res.status(400).json({ error: 'seconds must be a number' });
  }
  state.currentTimer = Math.max(0, state.currentTimer + seconds);
  io.emit('timerTick', { currentTimer: state.currentTimer, timerPaused: state.timerPaused });
  res.json({ ok: true, currentTimer: state.currentTimer });
});

app.post('/admin/timer/reset', requireAdminAuth, (req, res) => {
  state.currentTimer = STARTING_SECONDS;
  io.emit('timerTick', { currentTimer: state.currentTimer, timerPaused: state.timerPaused });
  res.json({ ok: true, currentTimer: state.currentTimer });
});

// -- Test alerts — visual/audio preview only, never touches real state --
app.post('/admin/test/donation', requireAdminAuth, (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'TestDonor';
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  io.emit('newDonation', { name, amount, test: true });
  res.json({ ok: true });
});

app.post('/admin/test/milestone', requireAdminAuth, (req, res) => {
  const body = req.body || {};
  const amount = Number(body.amount);
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'Test milestone';
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  io.emit('milestoneReached', { amount, label, test: true });
  res.json({ ok: true });
});

// -- Milestone editor --
app.get('/admin/milestones', requireAdminAuth, (req, res) => {
  res.json({ milestones: serializeMilestones() });
});

app.post('/admin/milestones', requireAdminAuth, (req, res) => {
  const incoming = req.body && req.body.milestones;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ error: 'milestones must be an array' });
  }
  saveMilestones(incoming);
  res.json({ ok: true, milestones: serializeMilestones() });
});

// -- Sound upload for donation tiers --
app.post('/admin/upload-sound', requireAdminAuth, soundUpload.single('file'), (req, res) => {
  const tierId = req.body && req.body.tier;
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  if (!req.file.mimetype || !req.file.mimetype.startsWith('audio/')) {
    return res.status(400).json({ error: 'File must be an audio file' });
  }

  const tiers = loadDonationTiers();
  const tier = tiers.find((t) => t.id === tierId);
  if (!tier || typeof tier.sound !== 'string') {
    return res.status(400).json({ error: `Unknown tier "${tierId}"` });
  }

  // Destination is derived only from the filename portion of the
  // server-controlled donation-tiers.json entry (never from user input or
  // the uploaded file's own name), so this can't write outside SOUNDS_DIR.
  const destPath = path.join(SOUNDS_DIR, path.basename(tier.sound));

  fs.mkdirSync(SOUNDS_DIR, { recursive: true });
  fs.writeFileSync(destPath, req.file.buffer);

  console.log(`[admin] uploaded sound for ${tierId}: ${destPath} (${req.file.size} bytes)`);
  res.json({ ok: true, tier: tierId, path: tier.sound });
});

// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`Twitch Charity Overlay server listening on http://localhost:${PORT}`);
  console.log(`Tracking Extra Life participant ${PARTICIPANT_ID}, goal $${GOAL_AMOUNT}`);
});
