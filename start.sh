#!/usr/bin/env bash
# Starts the whole system with an embedded database (no PostgreSQL install needed).
# First run installs and builds everything, then opens http://localhost:3000
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node.js 22 (LTS) from https://nodejs.org and run this again."
  exit 1
fi
MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 22 ]; then
  echo "Node.js 22 or newer is required (you have $(node -v)). Get it from https://nodejs.org"
  exit 1
fi

[ -d backend/node_modules ] || { echo "Installing backend packages (first run only)..."; npm install --prefix backend; }
[ -d web/node_modules ]     || { echo "Installing web packages (first run only)...";     npm install --prefix web; }
[ -f backend/dist/main.js ] || { echo "Building backend...";  npm run build --prefix backend; }
[ -f web/dist/index.html ]  || { echo "Building web app..."; npm run build --prefix web; }

PORT="${PORT:-3000}"
export PORT
if [ -z "$NO_OPEN" ]; then
  ( sleep 8; (xdg-open "http://localhost:$PORT" || open "http://localhost:$PORT") >/dev/null 2>&1 || true ) &
fi
echo "Starting on http://localhost:$PORT  (close this window to stop)"
exec npm run local --prefix backend
