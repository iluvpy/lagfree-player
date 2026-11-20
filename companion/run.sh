#!/usr/bin/env bash
# Launcher used by Chrome/Brave native messaging.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="${LAGFREE_VENV:-$HOME/.local/share/lagfree/venv}"

# yt-dlp may use a JavaScript runtime for YouTube's challenge solving. Desktop
# launches of browsers often have a smaller PATH than interactive shells.
for dir in \
  "$HOME"/.config/nvm/versions/node/*/bin \
  "$HOME"/.nvm/versions/node/*/bin \
  "$HOME"/.local/share/mise/installs/node/*/bin \
  /usr/local/bin; do
  if [ -d "$dir" ]; then PATH="$dir:$PATH"; fi
done
export PATH
export PYTHONUNBUFFERED=1
export PYTHONIOENCODING=utf-8

if [ -x "$VENV/bin/python" ]; then
  exec "$VENV/bin/python" "$HERE/lagfree_downloader.py"
fi
exec python3 "$HERE/lagfree_downloader.py"
