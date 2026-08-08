const socket = io();

const timerEl = document.getElementById('timer');
const goalTextEl = document.getElementById('goal-text');
const goalBarFillEl = document.getElementById('goal-bar-fill');
const latestHeroEl = document.getElementById('latest-hero');

const alertBoxEl = document.getElementById('alert-box');
const alertNameEl = document.getElementById('alert-name');
const alertAmountEl = document.getElementById('alert-amount');

const milestoneListEl = document.getElementById('milestone-list');
const goalBarMarkersEl = document.getElementById('goal-bar-markers');

const milestoneAlertEl = document.getElementById('milestone-alert');
const milestoneAlertAmountEl = document.getElementById('milestone-alert-amount');
const milestoneAlertLabelEl = document.getElementById('milestone-alert-label');

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

function updateTimer(seconds) {
  timerEl.textContent = formatTimer(seconds);
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
// Milestones — goal bar markers + the always-visible track panel
// --------------------------------------------------------------------------
function renderMilestones() {
  goalBarMarkersEl.innerHTML = '';
  for (const m of milestonesData) {
    const pct = goal > 0 ? Math.min(100, (m.amount / goal) * 100) : 0;

    const marker = document.createElement('div');
    marker.className = `goal-bar-marker${m.reached ? ' reached' : ''}`;
    marker.style.left = `${pct}%`;

    const label = document.createElement('span');
    label.className = 'goal-bar-marker-label';
    label.textContent = formatMoney(m.amount);

    const tick = document.createElement('span');
    tick.className = 'goal-bar-marker-tick';

    marker.append(label, tick);
    goalBarMarkersEl.appendChild(marker);
  }

  milestoneListEl.innerHTML = '';
  for (const m of milestonesData) {
    const item = document.createElement('div');
    item.className = `milestone-item${m.reached ? ' reached' : ''}`;

    const check = document.createElement('span');
    check.className = 'milestone-item-check';
    check.textContent = m.reached ? '✓' : '○';

    const amountEl = document.createElement('span');
    amountEl.className = 'milestone-item-amount';
    amountEl.textContent = formatMoney(m.amount);

    const labelEl = document.createElement('span');
    labelEl.className = 'milestone-item-label';
    labelEl.textContent = m.label;

    item.append(check, amountEl, labelEl);
    milestoneListEl.appendChild(item);
  }
}

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

  alertNameEl.textContent = name;
  alertAmountEl.textContent = formatMoney(amount);
  alertBoxEl.classList.add('show');

  setTimeout(() => {
    alertBoxEl.classList.remove('show');
    setTimeout(() => {
      alertShowing = false;
      processAlertQueue();
    }, 500); // matches CSS fade-out transition duration
  }, 5000);
}

// --------------------------------------------------------------------------
// Socket.io events
// --------------------------------------------------------------------------
socket.on('state', (data) => {
  if (typeof data.goal === 'number') goal = data.goal;
  updateTimer(data.currentTimer);
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
  updateTimer(data.currentTimer);
});

socket.on('totalUpdate', (data) => {
  if (typeof data.goal === 'number') goal = data.goal;
  updateGoal(data.totalRaised);
});

socket.on('newDonation', (data) => {
  updateLatestHero(data.name, data.amount);
  queueAlert(data.name, data.amount);
});
