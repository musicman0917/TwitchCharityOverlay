# Deploy / update the NOM Charity Overlay on the streaming PC.
# Run this from PowerShell on the box that also runs nom-token-broker.
#
# First-time setup: this script pulls the repo if it already exists locally,
# or clones it if it doesn't -- so it's safe to re-run any time you want to
# pick up the latest changes and restart the pm2 process.

$ErrorActionPreference = "Stop"

$repoUrl = "https://github.com/musicman0917/TwitchCharityOverlay.git"
$branch  = "claude/twitch-charity-subathon-overlay-qtwc8a"
$dest    = "C:\Users\music\Documents\CharityOverlay"

foreach ($cmd in @("git", "node", "npm", "pm2")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Error "'$cmd' was not found on PATH. Install it before running this script."
        exit 1
    }
}

if (Test-Path (Join-Path $dest ".git")) {
    Write-Host "Existing checkout found -- pulling latest changes..."
    Set-Location $dest
    git fetch origin $branch
    git checkout $branch
    git pull origin $branch
} else {
    Write-Host "Cloning repo into $dest ..."
    git clone -b $branch --single-branch $repoUrl $dest
    Set-Location $dest
}

Write-Host "Installing dependencies..."
npm install

Write-Host "Starting/restarting with pm2..."
# Avoid `pm2 jlist | ConvertFrom-Json` here -- on Windows pm2 dumps the full
# process environment into jlist, which can contain keys that differ only by
# case (e.g. USERNAME/username), and ConvertFrom-Json throws on those.
# Just try a restart first and fall back to a fresh start if it fails.
pm2 restart nom-charity-overlay 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "No existing nom-charity-overlay process -- starting fresh..."
    pm2 start ecosystem.config.js
}
pm2 save

Write-Host "Done. Current pm2 processes:"
pm2 list
