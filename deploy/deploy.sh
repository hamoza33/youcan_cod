#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/cod-youcan-gmc-automation}"
REPO_URL="${REPO_URL:-}"

if [[ -z "$REPO_URL" ]]; then
  echo "Set REPO_URL to the GitHub repository URL before running this script." >&2
  exit 1
fi

sudo mkdir -p "$APP_DIR"
sudo chown "$USER":"$USER" "$APP_DIR"

if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
git pull --ff-only

if [[ ! -f .env.production ]]; then
  echo "Create $APP_DIR/.env.production with production secrets before deployment." >&2
  exit 1
fi

docker compose build
docker compose up -d

echo "Deploy complete. Configure Caddy with deploy/Caddyfile and point your app domain to this VPS."
