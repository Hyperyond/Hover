#!/usr/bin/env bash
# Start a debug-mode Chrome on port 9222 with an isolated profile.
#
# Why this script and not `open -na`:
#   On macOS, `open -na "Google Chrome" --args ...` is unreliable when the user
#   already has a regular Chrome instance running — macOS may join the existing
#   process and silently drop the --remote-debugging-port flag. We invoke the
#   binary directly and use --user-data-dir to force a fresh process tree.
#
# Idempotent: if 9222 already responds, exits 0 without touching anything.

set -eu

CDP="http://localhost:9222"
DATA_DIR="/tmp/hover-smoke"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if curl -sf "$CDP/json/version" >/dev/null 2>&1; then
  echo "[hover:chrome] already listening on 9222"
  exit 0
fi

# Kill anything still holding the hover data-dir (crashed/orphaned previous run)
pkill -f "user-data-dir=$DATA_DIR" >/dev/null 2>&1 || true

if [ ! -x "$CHROME_BIN" ]; then
  echo "[hover:chrome] Chrome not found at: $CHROME_BIN" >&2
  exit 1
fi

# Direct binary launch, detached. < /dev/null + nohup keeps it alive after this
# script exits. --no-first-run avoids the welcome screen on fresh profiles.
nohup "$CHROME_BIN" \
  --remote-debugging-port=9222 \
  --user-data-dir="$DATA_DIR" \
  --no-first-run \
  --no-default-browser-check \
  about:blank \
  </dev/null >/dev/null 2>&1 &
disown

for _ in $(seq 1 30); do
  sleep 0.3
  if curl -sf "$CDP/json/version" >/dev/null 2>&1; then
    echo "[hover:chrome] ready on 9222 (data-dir=$DATA_DIR)"
    exit 0
  fi
done

echo "[hover:chrome] failed to start Chrome on 9222 within 9s" >&2
exit 1
