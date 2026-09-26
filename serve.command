#!/bin/bash
# Double-click this to run the Hebrew trainer over http so the AI-sentence feature works
# (Ollama rejects file:// pages). It finds a free port automatically, opens your browser,
# and serves this folder. Leave the window open while you use the app; Ctrl-C to stop.
cd "$(dirname "$0")" || exit 1
PORT=8777
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done
URL="http://localhost:$PORT/index.html"
echo "Serving the Hebrew trainer at $URL"
echo "Keep this window open. Press Ctrl-C to stop."
( sleep 1; open "$URL" ) &
exec python3 -m http.server "$PORT"
