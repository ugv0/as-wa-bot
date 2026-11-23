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
    git add session.enc endpoint.txt 2>/dev/null || true
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
    if [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
        echo "Stopping Cloudflare Tunnel..."
        kill -TERM "$TUNNEL_PID" 2>/dev/null || true
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

# Install & Start Cloudflare Tunnel for Remote Dashboard Access
if ! command -v cloudflared &> /dev/null; then
    echo "Installing Cloudflared..."
    curl -sL --output cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
    chmod +x cloudflared
    sudo mv cloudflared /usr/local/bin/cloudflared || true
fi

if command -v cloudflared &> /dev/null; then
    echo "Launching Cloudflare Quick Tunnel on port $PORT..."
    cloudflared tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate > tunnel.log 2>&1 &
    TUNNEL_PID=$!

    for i in $(seq 1 45); do
        sleep 1
        if grep -o "https://[-a-zA-Z0-9@:%._\+~#=]\+\.trycloudflare\.com" tunnel.log | grep -v "api.trycloudflare.com" > /dev/null 2>&1; then
            PUBLIC_URL=$(grep -o "https://[-a-zA-Z0-9@:%._\+~#=]\+\.trycloudflare\.com" tunnel.log | grep -v "api.trycloudflare.com" | head -n 1)
            echo "===================================================================="
            echo " 🌐 LIVE CLOUDFLARE BOT RELAY URL: $PUBLIC_URL"
            echo "===================================================================="
            echo "$PUBLIC_URL" > endpoint.txt

            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            if [ -n "$GH_PAT" ]; then
                git remote set-url origin "https://x-access-token:${GH_PAT}@github.com/${REPO}.git"
            fi
            git add endpoint.txt
            git commit -m "chore: update live endpoint.txt [skip ci]" || true
            git push origin main || true
            break
        fi
    done
fi

echo "Active session serving incoming WhatsApp messages for ${RESTART_INTERVAL} seconds..."
sleep "$RESTART_INTERVAL"

echo "Cycle completed. Initiating graceful restart..."
kill -TERM "$SERVER_PID" 2>/dev/null || true
sleep 4
sync_credentials || true
