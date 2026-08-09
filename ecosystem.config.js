module.exports = {
  apps: [
    {
      name: 'nom-charity-overlay',
      script: 'server.js',
      cwd: __dirname,
      env: {
        PORT: 3011,
        PARTICIPANT_ID: '567118',
        GOAL_AMOUNT: 1000,
        POLL_INTERVAL_MS: 15000,
        NOM_ALERTS_BASE_URL: 'http://localhost:3010',
        // Base timer duration in hours -- only used on the very first-ever
        // boot (no .overlay-state.json yet). Change this any time before
        // that, or adjust the base later via the admin portal instead.
        STARTING_HOURS: 4,
      },
    },
  ],
};
