#!/usr/bin/env python3
"""
LagFree download helper — a native messaging host.

The extension sends one download job per process over stdin/stdout using the
Chrome native-messaging framing. The host uses yt-dlp for extraction/download
and ffmpeg for muxing, then writes the finished file to ~/Downloads/LagFree.

Nothing is uploaded. This process runs only when the extension asks for it.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import struct
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path
from urllib.parse import urlparse

try:
    import yt_dlp
except Exception as exc:  # pragma: no cover - reported through ping/start
    yt_dlp = None
    YTDLP_IMPORT_ERROR = str(exc)
else:
    YTDLP_IMPORT_ERROR = ""

HOST_VERSION = "1.0.1"
HOST_NAME = "com.lagfree.downloader"
MAX_MESSAGE = 1024 * 1024
REAL_HOME = Path(
    os.environ.get("LAGFREE_REAL_HOME")
    or os.environ.get("SNAP_REAL_HOME")
    or str(Path.home())
).expanduser()
OUTPUT_DIR = Path(
    os.environ.get("LAGFREE_OUTPUT_DIR") or (REAL_HOME / "Downloads" / "LagFree")
).expanduser()
CACHE_DIR = REAL_HOME / "lagfree-companion" / "cache"
JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
QUALITIES = {"720", "1080", "best", "audio"}

_stdout_lock = threading.Lock()
_worker = None
_cancel_event = None
_video_id = None


# ---------------------------------------------------------------------------
# Native messaging framing
# ---------------------------------------------------------------------------


def send(message):
    """Send one length-prefixed JSON message. Never write anything else to stdout."""
    data = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(data) > MAX_MESSAGE:
        data = json.dumps(
            {"type": "error", "error": "Helper message too large."},
            separators=(",", ":"),
        ).encode("utf-8")
    with _stdout_lock:
        try:
            sys.stdout.buffer.write(struct.pack("<I", len(data)))
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
        except (BrokenPipeError, OSError):
            os._exit(0)


def read_message():
    try:
        header = sys.stdin.buffer.read(4)
        if not header or len(header) < 4:
            return None
        length = struct.unpack("<I", header)[0]
        if length <= 0 or length > MAX_MESSAGE:
            return None
        raw = sys.stdin.buffer.read(length)
        if not raw or len(raw) < length:
            return None
        return json.loads(raw.decode("utf-8"))
    except (EOFError, OSError, ValueError):
        return None


def finish(code=0, delay=0.2):
    """Flush and exit. The worker owns the lifecycle once a job is running."""
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:
        pass
    time.sleep(delay)
    os._exit(code)


# ---------------------------------------------------------------------------
# Tool metadata
# ---------------------------------------------------------------------------


def ytdlp_version():
    if not yt_dlp:
        return None
    return getattr(getattr(yt_dlp, "version", None), "__version__", None)


def find_ffmpeg():
    configured = os.environ.get("LAGFREE_FFMPEG")
    if configured and Path(configured).is_file():
        return configured
    return shutil.which("ffmpeg")


def tool_state():
    ffmpeg = find_ffmpeg()
    return {
        "version": HOST_VERSION,
        "ytdlp": ytdlp_version(),
        "ffmpeg": bool(ffmpeg),
        "ffmpegPath": ffmpeg or "",
        "python": sys.version.split()[0],
        "outputDir": str(OUTPUT_DIR),
    }


# ---------------------------------------------------------------------------
# Validation and formats
# ---------------------------------------------------------------------------


def canonical_youtube_url(value):
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.hostname or "").lower()
    if not (
        host == "youtu.be"
        or host == "youtube.com"
        or host.endswith(".youtube.com")
        or host == "youtube-nocookie.com"
        or host.endswith(".youtube-nocookie.com")
    ):
        return None

    video_id = None
    if host == "youtu.be":
        parts = [p for p in parsed.path.split("/") if p]
        if parts:
            video_id = parts[0]
    elif parsed.path == "/watch":
        video_id = dict(
            part.split("=", 1) for part in parsed.query.split("&") if "=" in part
        ).get("v")
    else:
        parts = [p for p in parsed.path.split("/") if p]
        if parts and parts[0] in ("embed", "shorts", "live", "v") and len(parts) > 1:
            video_id = parts[1]

    if not video_id or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        return None
    return f"https://www.youtube.com/watch?v={video_id}", video_id


def format_for_quality(quality):
    if quality == "audio":
        return "ba[acodec^=mp4a]/ba", None
    if quality == "best":
        return "bv*+ba/b", "mkv"
    height = 720 if quality == "720" else 1080
    selector = (
        f"bv*[height<={height}][vcodec^=avc1]+ba[acodec^=mp4a]"
        f"/bv*[height<={height}]+ba"
        f"/b[height<={height}]"
    )
    return selector, "mp4"


def quality_label(quality):
    return {
        "720": "720p MP4",
        "1080": "1080p MP4",
        "best": "Best (MKV)",
        "audio": "Audio only",
    }.get(quality, quality)


# ---------------------------------------------------------------------------
# Download job
# ---------------------------------------------------------------------------


class DownloadCancelled(Exception):
    pass


class QuietLogger:
    def debug(self, message):
        pass

    def warning(self, message):
        pass

    def error(self, message):
        if message:
            try:
                sys.stderr.write(str(message).strip() + "\n")
                sys.stderr.flush()
            except Exception:
                pass


def clean_error(error):
    text = str(error or "Unknown download error.").replace("\x1b", "")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^ERROR:\s*", "", text)
    text = re.sub(r"^\[[^\]]+\]\s*[^:]+:\s*", "", text)
    return text[:600]


def partial_files(video_id):
    if not OUTPUT_DIR.exists():
        return []
    found = []
    for path in OUTPUT_DIR.glob(f"*{video_id}*"):
        if not path.is_file():
            continue
        name = path.name
        if name.endswith((".part", ".ytdl", ".temp")) or re.search(r"\.f\d+\.", name):
            found.append(path)
    return found


def locate_result(info):
    requested = info.get("requested_downloads") or []
    for item in requested:
        for key in ("filepath", "_filename"):
            candidate = item.get(key)
            if candidate and Path(candidate).is_file():
                return Path(candidate)
    for key in ("filepath", "_filename"):
        candidate = info.get(key)
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    if _video_id:
        candidates = [
            path
            for path in OUTPUT_DIR.glob(f"*{_video_id}*")
            if path.is_file()
            and path.suffix.lower() in (".mp4", ".mkv", ".m4a", ".webm", ".opus")
        ]
        if candidates:
            return max(candidates, key=lambda p: p.stat().st_mtime)
    return None


def run_job(message, cancel_event):
    global _video_id
    job_id = message.get("jobId")
    quality = message.get("quality")
    if quality not in QUALITIES:
        quality = "1080"
    parsed = canonical_youtube_url(message.get("url"))
    if not parsed:
        send({"type": "error", "jobId": job_id, "error": "That link is not a supported YouTube video URL."})
        finish(1, 0.1)
        return
    url, video_id = parsed
    _video_id = video_id

    if not yt_dlp:
        send(
            {
                "type": "error",
                "jobId": job_id,
                "error": "yt-dlp is not installed for this helper. Run companion/setup.sh, then try again.",
                "code": "missing-ytdlp",
            }
        )
        finish(1, 0.1)
        return

    ffmpeg_path = find_ffmpeg()
    if not ffmpeg_path:
        send(
            {
                "type": "error",
                "jobId": job_id,
                "error": "ffmpeg is not available. Re-run companion/setup.sh, then try again.",
                "code": "missing-ffmpeg",
            }
        )
        finish(1, 0.1)
        return

    try:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        send({"type": "error", "jobId": job_id, "error": f"Could not create the download folder: {exc}"})
        finish(1, 0.1)
        return

    selector, merge_format = format_for_quality(quality)
    last_progress = [0.0]

    def progress_hook(data):
        if cancel_event.is_set():
            raise DownloadCancelled("cancelled")
        status = data.get("status")
        info = data.get("info_dict") or {}
        component = "audio" if info.get("vcodec") == "none" else "video"
        if status == "downloading":
            now = time.monotonic()
            if now - last_progress[0] < 0.25:
                return
            last_progress[0] = now
            total = data.get("total_bytes") or data.get("total_bytes_estimate") or 0
            downloaded = data.get("downloaded_bytes") or 0
            percent = (downloaded / total * 100.0) if total else 0.0
            send(
                {
                    "type": "progress",
                    "jobId": job_id,
                    "status": "downloading",
                    "stage": component,
                    "percent": round(min(99.9, max(0.0, percent)), 1),
                    "downloadedBytes": downloaded,
                    "totalBytes": total,
                    "speed": data.get("speed"),
                    "eta": data.get("eta"),
                    "title": info.get("title") or "",
                }
            )
        elif status == "finished":
            send(
                {
                    "type": "progress",
                    "jobId": job_id,
                    "status": "downloading",
                    "stage": component,
                    "percent": 100,
                    "title": info.get("title") or "",
                }
            )

    def postprocessor_hook(data):
        if cancel_event.is_set():
            raise DownloadCancelled("cancelled")
        if data.get("status") == "started":
            send(
                {
                    "type": "processing",
                    "jobId": job_id,
                    "status": "processing",
                    "stage": data.get("postprocessor") or "Processing",
                    "percent": 100,
                }
            )

    options = {
        "format": selector,
        "outtmpl": str(OUTPUT_DIR / "%(title).160B [%(id)s].%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [progress_hook],
        "postprocessor_hooks": [postprocessor_hook],
        "logger": QuietLogger(),
        "retries": 5,
        "fragment_retries": 5,
        "concurrent_fragment_downloads": 4,
        "socket_timeout": 25,
        "continuedl": True,
        "overwrites": False,
        "nocheckcertificate": False,
        "cachedir": str(CACHE_DIR / "yt-dlp"),
        "ffmpeg_location": ffmpeg_path,
    }
    if merge_format:
        options["merge_output_format"] = merge_format

    try:
        send(
            {
                "type": "status",
                "jobId": job_id,
                "status": "downloading",
                "stage": "Preparing",
                "quality": quality,
                "qualityLabel": quality_label(quality),
            }
        )
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=True)
        if cancel_event.is_set():
            raise DownloadCancelled("cancelled")
        path = locate_result(info)
        if not path:
            raise RuntimeError("The download finished but the output file could not be found.")
        send(
            {
                "type": "done",
                "jobId": job_id,
                "status": "complete",
                "path": str(path),
                "filename": path.name,
                "filesize": path.stat().st_size,
                "title": info.get("title") or "",
                "duration": info.get("duration"),
                "quality": quality,
                "qualityLabel": quality_label(quality),
            }
        )
        finish(0, 0.25)
    except DownloadCancelled:
        for path in partial_files(video_id):
            try:
                path.unlink()
            except Exception:
                pass
        send({"type": "cancelled", "jobId": job_id, "status": "cancelled"})
        finish(0, 0.1)
    except Exception as exc:
        if cancel_event.is_set():
            for path in partial_files(video_id):
                try:
                    path.unlink()
                except Exception:
                    pass
            send({"type": "cancelled", "jobId": job_id, "status": "cancelled"})
            finish(0, 0.1)
            return
        for path in partial_files(video_id):
            try:
                path.unlink()
            except Exception:
                pass
        try:
            traceback.print_exc(file=sys.stderr)
        except Exception:
            pass
        send(
            {
                "type": "error",
                "jobId": job_id,
                "status": "error",
                "error": clean_error(exc),
            }
        )
        finish(1, 0.1)


# ---------------------------------------------------------------------------
# Other commands
# ---------------------------------------------------------------------------


def open_folder(path_value):
    try:
        path = Path(path_value).expanduser().resolve()
        home = REAL_HOME.resolve()
        if home not in path.parents and path != home:
            raise ValueError("Folder is outside the home directory.")
        target = path if path.is_dir() else path.parent
        if not target.exists():
            raise FileNotFoundError("The download folder does not exist yet.")
        if sys.platform == "darwin":
            subprocess.Popen(["open", str(target)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif os.name == "nt":
            os.startfile(str(target))  # type: ignore[attr-defined]
        else:
            subprocess.Popen(
                ["xdg-open", str(target)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        send({"type": "opened", "path": str(target)})
    except Exception as exc:
        send({"type": "error", "error": clean_error(exc)})
    finish(0, 0.1)


def main():
    global _worker, _cancel_event
    while True:
        message = read_message()
        if message is None:
            if _cancel_event:
                _cancel_event.set()
            break
        if not isinstance(message, dict):
            continue
        kind = message.get("type")
        if kind == "ping":
            state = tool_state()
            state.update({"type": "pong", "host": HOST_NAME})
            if not state["ytdlp"]:
                state["error"] = "The helper's Python environment is missing yt-dlp."
            elif not state["ffmpeg"]:
                state["error"] = "ffmpeg is not installed."
            send(state)
        elif kind == "start":
            job_id = message.get("jobId")
            if not isinstance(job_id, str) or not JOB_ID_RE.fullmatch(job_id):
                send({"type": "error", "error": "Invalid job id."})
                continue
            if _worker and _worker.is_alive():
                send({"type": "error", "jobId": job_id, "error": "This helper is already downloading another file."})
                continue
            _cancel_event = threading.Event()
            _worker = threading.Thread(
                target=run_job,
                args=(message, _cancel_event),
                name="lagfree-download",
                daemon=True,
            )
            _worker.start()
        elif kind == "cancel":
            if _cancel_event:
                _cancel_event.set()
        elif kind == "open-folder":
            open_folder(message.get("path") or "")
        else:
            send({"type": "error", "error": f"Unknown helper command: {kind}"})

    if _cancel_event:
        _cancel_event.set()
    if _worker:
        _worker.join(timeout=2)
    finish(0, 0.05)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        try:
            traceback.print_exc(file=sys.stderr)
        except Exception:
            pass
        finish(1, 0.05)
