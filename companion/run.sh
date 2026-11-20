#!/usr/bin/env bash
# Launcher used by Chrome/Brave native messaging.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Snap browsers run with HOME=~/snap/<browser>/<rev>. The real home is exposed
# as SNAP_REAL_HOME. Fall back to HOME for normal installs.
REAL_HOME="${SNAP_REAL_HOME:-$HOME}"
VENV="${LAGFREE_VENV:-$REAL_HOME/lagfree-companion/venv}"

export LAGFREE_REAL_HOME="$REAL_HOME"
export LAGFREE_OUTPUT_DIR="${LAGFREE_OUTPUT_DIR:-$REAL_HOME/Downloads/LagFree}"
export PYTHONUNBUFFERED=1
export PYTHONIOENCODING=utf-8

# yt-dlp may use a JavaScript runtime for YouTube challenge solving. Desktop
# launches often have a smaller PATH than interactive shells. Snap cannot
# execute hidden-home binaries, so these are best-effort additions.
for dir in \
  "$REAL_HOME"/.config/nvm/versions/node/*/bin \
  "$REAL_HOME"/.nvm/versions/node/*/bin \
  "$REAL_HOME"/.local/share/mise/installs/node/*/bin \
  /usr/local/bin; do
  if [ -d "$dir" ]; then PATH="$dir:$PATH"; fi
done
export PATH

if [ -x "$VENV/bin/python" ]; then
  # imageio-ffmpeg ships a static ffmpeg that survives Snap's filesystem
  # sandbox; the host falls back to system ffmpeg when this is absent.
  FFMPEG="$("$VENV/bin/python" -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())' 2>/dev/null || true)"
  if [ -n "$FFMPEG" ] && [ -x "$FFMPEG" ]; then
    export LAGFREE_FFMPEG="$FFMPEG"
    PATH="$(dirname "$FFMPEG"):$PATH"
    export PATH
  fi
  exec "$VENV/bin/python" "$HERE/lagfree_downloader.py"
fi
exec python3 "$HERE/lagfree_downloader.py"
