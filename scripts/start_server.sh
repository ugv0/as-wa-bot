#!/usr/bin/env bash
set -eo pipefail

PORT="${PORT:-3000}"
RESTART_INTERVAL="${RESTART_INTERVAL_SECONDS:-19800}"
REPO="ugv0/as-wa-bot"

echo "===================================================================="
echo " 🚀 Starting AS WhatsApp Nemotron AI Bot (6-Hour Cycle)"
echo " Port: $PORT | Auto-restart interval: ${RESTART_INTERVAL}s (~5.5h)"
echo "===================================================================="

# 1. Unpack session credentials from encrypted file if present
node scripts/unpack_session.js || echo "Unpack session skipped or failed."

sync_credentials() {
    echo "Packing and syncing updated WhatsApp session credentials to GitHub..."
    node scripts/pack_session.js || echo "Pack session skipped or failed."
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
    if [ -n "$GH_PAT" ]; then
        git remote set-url origin "https://x-access-token:${GH_PAT}@github.com/${REPO}.git"
    fi
    git add session.enc
    git commit -m "chore(auth): sync updated encrypted session [skip ci]" || echo "No session changes to commit."
    git push origin main || echo "Git push skipped or no changes."
}

cleanup() {
    echo "Caught termination signal. Performing graceful shutdown..."
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "Stopping WhatsApp bot process (PID: $SERVER_PID)..."
        kill -TERM "$SERVER_PID" 2>/dev/null || true
        sleep 4
    fi
    sync_credentials || true
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Start Node.js WhatsApp Bot Server
node index.js &
SERVER_PID=$!
echo "WhatsApp Bot server started with PID: $SERVER_PID"

echo "Waiting for local HTTP server to become ready..."
for i in $(seq 1 40); do
    if curl -s "http://127.0.0.1:$PORT/api/status" > /dev/null 2>&1; then
        echo "Local server is READY & ACTIVE!"
        break
    fi
    sleep 1
done

echo "Active session serving incoming WhatsApp messages for ${RESTART_INTERVAL} seconds..."
sleep "$RESTART_INTERVAL"

echo "Cycle completed. Initiating graceful restart..."
kill -TERM "$SERVER_PID" 2>/dev/null || true
sleep 4
sync_credentials || true
