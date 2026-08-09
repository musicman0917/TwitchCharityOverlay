# Overlay images

QR code and logo images uploaded through the admin portal's "Asset Images" panel land here,
named `<asset-id>.<ext>` (e.g. `qr-code.png`, `extra-life-logo.svg`). `asset-images.json`
(repo root's `public/` folder) tracks which file belongs to which asset box on the overlay.

You don't need to touch this folder directly — use the admin portal at `/admin.html`. It's
documented here in case you ever want to inspect or manually replace a file.
