const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const PARTICIPANT_ID = process.env.PARTICIPANT_ID || '567118';
const GOAL_AMOUNT = Number(process.env.GOAL_AMOUNT || 1000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);
const STARTING_SECONDS = 4 * 60 * 60; // 04:00:00
const SECONDS_PER_DOLLAR = 60; // +1 minute per $1 donated

const PARTICIPANT_URL = `https://extra-life.org/api/participants/${PARTICIPANT_ID}`;
const DONATIONS_URL = `https://extra-life.org/api/participants/${PARTICIPANT_ID}/donations`;

const donorDriveClient = axios.create({
  timeout: 10000,
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
};

// ---------------------------------------------------------------------------
// App / server setup
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

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
  };
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
server.listen(PORT, () => {
  console.log(`Twitch Charity Overlay server listening on http://localhost:${PORT}`);
  console.log(`Tracking Extra Life participant ${PARTICIPANT_ID}, goal $${GOAL_AMOUNT}`);
});
