const socket = io();

const timerEl = document.getElementById('timer');
const goalTextEl = document.getElementById('goal-text');
const goalBarFillEl = document.getElementById('goal-bar-fill');
const latestHeroEl = document.getElementById('latest-hero');

const alertBoxEl = document.getElementById('alert-box');
const alertNameEl = document.getElementById('alert-name');
const alertAmountEl = document.getElementById('alert-amount');

const goalBarMarkersEl = document.getElementById('goal-bar-markers');

const milestoneAlertEl = document.getElementById('milestone-alert');
const milestoneAlertAmountEl = document.getElementById('milestone-alert-amount');
const milestoneAlertLabelEl = document.getElementById('milestone-alert-label');

const nextMilestoneEl = document.getElementById('next-milestone');
const nextMilestoneAmountEl = document.getElementById('next-milestone-amount');
const nextMilestoneTextEl = document.getElementById('next-milestone-text');

let goal = 1000;
let milestonesData = [];

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'disney') {
    root.setAttribute('data-theme', 'disney');
  } else {
    root.removeAttribute('data-theme'); // 'tavern' (default) or any other unrecognized theme
  }
}

function formatTimer(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatMoney(amount) {
  return `$${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function updateTimer(seconds, paused) {
  timerEl.textContent = formatTimer(seconds);
  timerEl.classList.toggle('paused', !!paused);
}

function updateGoal(totalRaised) {
  goalTextEl.textContent = `${formatMoney(totalRaised)} / ${formatMoney(goal)} — For Dayton Children's Hospital`;
  const pct = goal > 0 ? Math.min(100, (totalRaised / goal) * 100) : 0;
  goalBarFillEl.style.width = `${pct}%`;
}

function updateLatestHero(name, amount) {
  if (!name) return;
  latestHeroEl.textContent = `${name} — ${formatMoney(amount)}`;
}

// --------------------------------------------------------------------------
// Milestones — tick marks on the goal bar
// --------------------------------------------------------------------------
function renderMilestones() {
  goalBarMarkersEl.innerHTML = '';
  for (const m of milestonesData) {
    const pct = goal > 0 ? Math.min(100, (m.amount / goal) * 100) : 0;

    const marker = document.createElement('div');
    marker.className = `goal-bar-marker${m.reached ? ' reached' : ''}`;
    marker.style.left = `${pct}%`;

    const tick = document.createElement('span');
    tick.className = 'goal-bar-marker-tick';

    marker.appendChild(tick);
    goalBarMarkersEl.appendChild(marker);
  }
}

// --------------------------------------------------------------------------
// "Next Milestone" callout — pops in near the goal bar every ~90s for ~8s,
// showing whichever milestone hasn't been reached yet. Purely time-based
// (not tied to donation events), and simply does nothing if every
// milestone has already been reached.
// --------------------------------------------------------------------------
const NEXT_MILESTONE_INITIAL_DELAY_MS = 5000;
const NEXT_MILESTONE_INTERVAL_MS = 90000;
const NEXT_MILESTONE_VISIBLE_MS = 8000;

function getNextMilestone() {
  return milestonesData.find((m) => !m.reached) || null;
}

function showNextMilestoneCallout() {
  const next = getNextMilestone();
  if (!next) return; // every milestone already reached — nothing to tease

  nextMilestoneAmountEl.textContent = formatMoney(next.amount);
  nextMilestoneTextEl.textContent = next.label;
  nextMilestoneEl.classList.add('show');

  setTimeout(() => {
    nextMilestoneEl.classList.remove('show');
  }, NEXT_MILESTONE_VISIBLE_MS);
}

setTimeout(() => {
  showNextMilestoneCallout();
  setInterval(showNextMilestoneCallout, NEXT_MILESTONE_INTERVAL_MS);
}, NEXT_MILESTONE_INITIAL_DELAY_MS);

// --------------------------------------------------------------------------
// Milestone alert queue — bigger, full-screen, stays longer than a normal
// donation alert since crossing a milestone is a bigger deal
// --------------------------------------------------------------------------
const milestoneAlertQueue = [];
let milestoneAlertShowing = false;

function queueMilestoneAlert(amount, label) {
  milestoneAlertQueue.push({ amount, label });
  processMilestoneAlertQueue();
}

function processMilestoneAlertQueue() {
  if (milestoneAlertShowing || milestoneAlertQueue.length === 0) return;
  const { amount, label } = milestoneAlertQueue.shift();
  milestoneAlertShowing = true;

  milestoneAlertAmountEl.textContent = formatMoney(amount);
  milestoneAlertLabelEl.textContent = label;
  milestoneAlertEl.classList.add('show');

  setTimeout(() => {
    milestoneAlertEl.classList.remove('show');
    setTimeout(() => {
      milestoneAlertShowing = false;
      processMilestoneAlertQueue();
    }, 500); // matches CSS fade-out transition duration
  }, 8000);
}

// --------------------------------------------------------------------------
// Donation tiers — thresholds/sound/duration are configured in
// donation-tiers.json (fetched once below), purely a presentation concern:
// bigger donations get a bigger, longer, more glowing alert plus a louder
// tier of sound effect. Falls back to a single default tier if the file is
// missing/unreachable so the alert still works either way.
// --------------------------------------------------------------------------
const DEFAULT_DONATION_TIER = { id: 'tier1', minAmount: 0, durationMs: 5000, sound: null };
let donationTiers = [DEFAULT_DONATION_TIER];

fetch('donation-tiers.json')
  .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
  .then((data) => {
    if (Array.isArray(data) && data.length) {
      donationTiers = [...data].sort((a, b) => a.minAmount - b.minAmount);
    }
  })
  .catch((err) => {
    console.warn(`[donation-tiers] could not load donation-tiers.json (${err.message}); using default tier`);
  });

function getTierForAmount(amount) {
  let match = donationTiers[0];
  for (const tier of donationTiers) {
    if (amount >= tier.minAmount) match = tier;
  }
  return match;
}

const DONATION_SOUND_VOLUME = 0.8;
const donationSoundCache = {};

function playDonationSound(tier) {
  if (!tier.sound) return;
  let audio = donationSoundCache[tier.id];
  if (!audio) {
    audio = new Audio(tier.sound);
    audio.volume = DONATION_SOUND_VOLUME;
    donationSoundCache[tier.id] = audio;
  }
  audio.currentTime = 0;
  audio.play().catch(() => {
    // Missing/unreadable sound file — silently no-op until a real file is
    // dropped in public/Assets/Sounds/ (see the README there).
  });
}

// --------------------------------------------------------------------------
// Alert queue so overlapping donations still get shown one at a time
// --------------------------------------------------------------------------
const alertQueue = [];
let alertShowing = false;

function queueAlert(name, amount) {
  alertQueue.push({ name, amount });
  processAlertQueue();
}

function processAlertQueue() {
  if (alertShowing || alertQueue.length === 0) return;
  const { name, amount } = alertQueue.shift();
  alertShowing = true;

  const tier = getTierForAmount(amount);

  alertNameEl.textContent = name;
  alertAmountEl.textContent = formatMoney(amount);
  alertBoxEl.classList.remove('tier1', 'tier2', 'tier3');
  alertBoxEl.classList.add(tier.id, 'show');
  playDonationSound(tier);

  setTimeout(() => {
    alertBoxEl.classList.remove('show');
    setTimeout(() => {
      alertShowing = false;
      processAlertQueue();
    }, 500); // matches CSS fade-out transition duration
  }, tier.durationMs || 5000);
}

// --------------------------------------------------------------------------
// Socket.io events
// --------------------------------------------------------------------------
socket.on('state', (data) => {
  if (typeof data.goal === 'number') goal = data.goal;
  updateTimer(data.currentTimer, data.timerPaused);
  updateGoal(data.totalRaised);
  if (data.latestDonorName) {
    updateLatestHero(data.latestDonorName, data.latestDonorAmount);
  }
  applyTheme(data.theme);
  milestonesData = Array.isArray(data.milestones) ? data.milestones : [];
  renderMilestones();
});

socket.on('milestonesUpdate', (data) => {
  milestonesData = Array.isArray(data.milestones) ? data.milestones : [];
  renderMilestones();
});

socket.on('milestoneReached', (data) => {
  queueMilestoneAlert(data.amount, data.label);
});

socket.on('themeUpdate', (data) => {
  applyTheme(data.theme);
});

socket.on('timerTick', (data) => {
  updateTimer(data.currentTimer, data.timerPaused);
});

socket.on('totalUpdate', (data) => {
  if (typeof data.goal === 'number') goal = data.goal;
  updateGoal(data.totalRaised);
});

socket.on('newDonation', (data) => {
  if (!data.test) {
    updateLatestHero(data.name, data.amount);
  }
  queueAlert(data.name, data.amount);
});
