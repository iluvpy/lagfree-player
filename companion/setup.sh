#!/usr/bin/env bash
# Install the LagFree native-messaging download helper.
# Linux and macOS. Requires Python 3 and ffmpeg; yt-dlp is installed in a venv.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd "$HERE/.." && pwd)"
HOST_NAME="com.lagfree.downloader"
VENV="${LAGFREE_VENV:-$HOME/lagfree-companion/venv}"
EXTENSION_ID=""
INSTALL_DEPS=1
UNINSTALL=0
PYTHON="${PYTHON:-python3}"

usage() {
  cat <<USAGE
LagFree download helper setup

Usage: $0 [options]

  --extension-id ID   Override the detected extension id
  --no-deps           Do not create/update the yt-dlp virtualenv
  --uninstall         Remove native host manifests (leaves the venv)
  -h, --help          Show this help

The helper is installed for Chrome, Chromium, Brave and Edge user profiles.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --extension-id)
      [ $# -ge 2 ] || { echo "Missing value for --extension-id" >&2; exit 1; }
      EXTENSION_ID="$2"; shift 2 ;;
    --no-deps) INSTALL_DEPS=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

HOST_DIRS=()
add_host_dir() {
  local candidate
  [ -n "${1:-}" ] || return 0
  [ -d "$(dirname "$1")" ] || return 0
  candidate="$(realpath -m "$1")"
  for existing in "${HOST_DIRS[@]:-}"; do
    [ "$existing" = "$candidate" ] && return 0
  done
  HOST_DIRS+=("$candidate")
}

SNAP_BROWSER=0
if [ "$(uname -s)" = "Darwin" ]; then
  add_host_dir "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  add_host_dir "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
  add_host_dir "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  add_host_dir "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
else
  add_host_dir "$HOME/.config/google-chrome/NativeMessagingHosts"
  add_host_dir "$HOME/.config/google-chrome-beta/NativeMessagingHosts"
  add_host_dir "$HOME/.config/chromium/NativeMessagingHosts"
  add_host_dir "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  add_host_dir "$HOME/.config/microsoft-edge/NativeMessagingHosts"

  # Snap browsers have their own $HOME under ~/snap/<name>/<revision>. Native
  # messaging manifests must be inside that sandbox config, not ~/.config.
  for base in "$HOME"/snap/brave/* "$HOME"/snap/brave/current; do
    if [ -d "$base/.config/BraveSoftware/Brave-Browser" ]; then
      add_host_dir "$base/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
      SNAP_BROWSER=1
    fi
  done
  for base in "$HOME"/snap/chromium/* "$HOME"/snap/chromium/current; do
    if [ -d "$base/.config/chromium" ]; then
      add_host_dir "$base/.config/chromium/NativeMessagingHosts"
      SNAP_BROWSER=1
    fi
  done

  # Flatpak builds keep their config under ~/.var/app.
  if [ -d "$HOME/.var/app/com.brave.Browser/config" ]; then
    add_host_dir "$HOME/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  fi
  if [ -d "$HOME/.var/app/org.chromium.Chromium/config" ]; then
    add_host_dir "$HOME/.var/app/org.chromium.Chromium/config/chromium/NativeMessagingHosts"
  fi
fi

if [ "$UNINSTALL" -eq 1 ]; then
  removed=0
  for dir in "${HOST_DIRS[@]}"; do
    if [ -f "$dir/$HOST_NAME.json" ]; then
      rm -f "$dir/$HOST_NAME.json"
      echo "Removed $dir/$HOST_NAME.json"
      removed=$((removed+1))
    fi
  done
  echo "Removed $removed native host manifest(s). The yt-dlp venv was left in place: $VENV"
  exit 0
fi

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "Python 3 is required. Install python3 and re-run this script." >&2
  exit 1
fi

if [ -z "$EXTENSION_ID" ]; then
  EXTENSION_ID="$("$PYTHON" - "$EXT_DIR" <<'PY'
import hashlib, sys
path = sys.argv[1]
digest = hashlib.sha256(path.encode("utf-8")).hexdigest()[:32]
print("".join(chr(ord("a") + int(ch, 16)) for ch in digest))
PY
)"
fi

if ! printf '%s' "$EXTENSION_ID" | grep -Eq '^[a-p]{32}$'; then
  echo "Invalid extension id: $EXTENSION_ID" >&2
  exit 1
fi

chmod +x "$HERE/run.sh" "$HERE/lagfree_downloader.py" "$HERE/setup.sh"

if [ "$INSTALL_DEPS" -eq 1 ]; then
  if [ ! -x "$VENV/bin/python" ]; then
    echo "Creating downloader environment at $VENV"
    "$PYTHON" -m venv "$VENV"
  fi
  echo "Installing/updating yt-dlp in $VENV"
  "$VENV/bin/python" -m pip install --quiet --upgrade pip
  "$VENV/bin/python" -m pip install --quiet --upgrade yt-dlp imageio-ffmpeg
fi

if [ -x "$VENV/bin/python" ]; then
  YTDLP_VERSION="$("$VENV/bin/python" - <<'PY' 2>/dev/null || true
import yt_dlp
print(yt_dlp.version.__version__)
PY
)"
  IMAGEIO_FFMPEG="$("$VENV/bin/python" - <<'PY' 2>/dev/null || true
import imageio_ffmpeg
print(imageio_ffmpeg.get_ffmpeg_exe())
PY
)"
else
  YTDLP_VERSION="missing"
  IMAGEIO_FFMPEG=""
fi

FFMPEG_PATH="$(command -v ffmpeg || true)"
if [ -z "$FFMPEG_PATH" ] && [ -n "$IMAGEIO_FFMPEG" ]; then
  FFMPEG_PATH="$IMAGEIO_FFMPEG (helper)"
fi

"$PYTHON" - "$HOST_NAME" "$EXTENSION_ID" "$HERE/run.sh" "${HOST_DIRS[@]}" <<'PY'
import json, os, pathlib, sys
host, extension_id, runner, *dirs = sys.argv[1:]
manifest = {
    "name": host,
    "description": "LagFree private download helper (yt-dlp + ffmpeg)",
    "path": str(pathlib.Path(runner).resolve()),
    "type": "stdio",
    "allowed_origins": [f"chrome-extension://{extension_id}/"],
}
for directory in dirs:
    target = pathlib.Path(directory)
    target.mkdir(parents=True, exist_ok=True)
    path = target / f"{host}.json"
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Installed {path}")
PY

echo
echo "LagFree downloader helper installed."
echo "  Extension ID : $EXTENSION_ID"
echo "  Native host  : $HOST_NAME"
echo "  Runner       : $HERE/run.sh"
echo "  yt-dlp       : ${YTDLP_VERSION:-unknown}"
echo "  ffmpeg       : ${FFMPEG_PATH:-NOT FOUND}"
echo "  Output folder: $HOME/Downloads/LagFree"
echo "  Helper ffmpeg: ${IMAGEIO_FFMPEG:-not installed}"
echo
if [ -z "$FFMPEG_PATH" ]; then
  echo "WARNING: ffmpeg was not found. Install it (e.g. sudo apt install ffmpeg) before downloading." >&2
fi
if [ "$SNAP_BROWSER" -eq 1 ]; then
  echo "Snap browser detected: manifests were also installed inside its sandbox config."
  echo "Fully quit and restart the browser (not just reload) so it picks them up."
fi
echo "Reload the extension from chrome://extensions (or brave://extensions) and reopen the player."
