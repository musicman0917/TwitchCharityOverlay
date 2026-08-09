# Donation alert sounds

Upload sound effects through the admin portal's "Donation Alert Sounds" panel
(`/admin.html`) — each tier (small/medium/large donation) can have **multiple** sounds
(select several files at once, the file picker supports multi-select), and the overlay picks
one at random each time an alert of that tier fires. Uploaded files land here as
`donation-tier-<tierId>-<random>.<ext>`, tracked in `public/donation-tiers.json`'s `sounds`
array per tier as `{"path": "...", "name": "..."}` — `name` is the original filename you
uploaded, shown in the admin panel so you can tell sounds apart without playing each one.
Use the admin panel to add or remove sounds — don't rename/delete files directly in this
folder, since the JSON manifest needs to stay in sync.

Until a tier has at least one sound, the overlay just silently skips playback (no errors, no
console spam) — see `playDonationSound()` in `public/script.js`. Supported formats: mp3, wav,
ogg, m4a, webm.
