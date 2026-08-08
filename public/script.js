const socket = io();

const timerEl = document.getElementById('timer');
const goalTextEl = document.getElementById('goal-text');
const goalBarFillEl = document.getElementById('goal-bar-fill');
const latestHeroEl = document.getElementById('latest-hero');

const alertBoxEl = document.getElementById('alert-box');
const alertNameEl = document.getElementById('alert-name');
const alertAmountEl = document.getElementById('alert-amount');

let goal = 1000;

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
