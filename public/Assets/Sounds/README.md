# Donation alert sounds

Drop your donation alert sound effects here, named to match `donation-tiers.json`:

- `donation-tier-1.mp3` — small donations ($1–$24)
- `donation-tier-2.mp3` — medium donations ($25–$99)
- `donation-tier-3.mp3` — large donations ($100+)

Until real files exist here, the overlay just silently skips playback (no errors, no
console spam) — see `playDonationSound()` in `public/script.js`. Change the file names,
thresholds, or per-tier duration in `public/donation-tiers.json` any time; no code changes
needed. Supported formats: anything the browser's `<audio>` element supports (mp3, wav, ogg).
