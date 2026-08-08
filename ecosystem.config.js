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
      },
    },
  ],
};
