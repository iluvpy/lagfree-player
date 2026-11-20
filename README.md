# LagFree — Smooth YouTube Player

A Discord-dark Chrome/Brave extension that takes the video you are already watching and opens it in a lean, pre-buffered player page — with an optional **private download** feature powered by a local helper.

The popup detects the current YouTube video. **Open LagFree Player** loads it in YouTube's lightweight embedded player with a custom shell, play queue, history, quality cap, H.264 boost and a lag guard. **Download** saves a local copy through the companion helper.

> LagFree is not affiliated with YouTube or Google. The download feature is intended only for content you have the rights to save, for private viewing. It does not bypass DRM or ads, and it never uploads your files anywhere.

---

## Install the extension

1. Open `chrome://extensions` (Brave: `brave://extensions`).
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and choose the folder you copied the extension to
   (for example `~/my-extensions/lagfree` or `~/my_extensions/lagfree-player`).
4. Pin **LagFree** to the toolbar.
5. Open any YouTube video, click the LagFree icon, then **Open LagFree Player**.

Keyboard shortcut: `Alt+Shift+L` opens the current YouTube video in LagFree.

> If you move the folder, reload the extension and re-run the download helper setup (the extension id changes). The extension must be loaded unpacked — do not drag the ZIP into Chrome.

---

## Set up downloads (Linux / macOS)

Downloads require a small local helper. It uses **yt-dlp** and **ffmpeg**, runs only when you start a download, and writes files to `~/Downloads/LagFree`.

Requirements: Python 3 and ffmpeg. The script installs/updates yt-dlp in its own venv.

Run the script **from the folder you loaded as the extension**:

```bash
cd /path/to/lagfree
bash companion/setup.sh
```

For example, if you loaded the extension from `~/my-extensions/lagfree`:

```bash
cd ~/my-extensions/lagfree
bash companion/setup.sh
```

Then reload LagFree from `chrome://extensions` / `brave://extensions`. If the helper still is not found, restart the browser once so it picks up the new native-host manifest.

The setup script:

- creates `~/.local/share/lagfree/venv` and installs the latest `yt-dlp`;
- checks for `ffmpeg` and warns if it is missing;
- makes the helper executable;
- writes native-messaging manifests for Chrome, Chromium, Brave and Edge under your user config, including the sandboxed config used by **Snap Brave**;
- computes the extension ID from this folder automatically (override with `--extension-id ID` if needed).

To remove the native-host registration later:

```bash
bash ~/my_extensions/lagfree-player/companion/setup.sh --uninstall
```

Files already downloaded are not touched.

> Snap Brave and Snap Chromium keep their config inside `~/snap/...`; the script detects this automatically. After setup, **fully quit and restart Brave** — a tab reload is not enough for native-host registration.
>
> The setup script covers Linux and macOS. A Windows install would additionally need the native host registered in the registry.

---

## What it does

### Player
- **Lightweight embed** — YouTube's `/embed/` player instead of the full watch page.
- **Pre-buffer** — plays the opening seconds muted to build a head start, then pauses at the beginning.
- **H.264 boost** — asks YouTube for H.264 instead of VP9/AV1, which is easier to decode on older CPUs/GPUs.
- **Quality cap** — defaults to 720p; change it live from the player or popup.
- **Lag guard** — detects repeated stalls and drops a quality step automatically.
- **Queue & history** — stored locally in the extension.
- **Downloads** — separate active/completed list with progress, cancel, retry and open-folder actions.

### Downloads
- Download from the **Download** button under the player, the popup, or the Downloads view.
- Quality choices:
  - **1080p · MP4** — H.264 + AAC, best compatibility (default)
  - **720p · MP4** — smaller H.264 copy
  - **Best available · MKV** — highest resolution, any codec
  - **Audio only · M4A**
- Progress shows the current stream, speed and ETA, then switches to “Merging audio + video”.
- Files are written by the helper to `~/Downloads/LagFree`.
- Cancel removes partial files. “Clear finished” removes entries from the list only; files stay in the folder.
- All processing is local. No account, server or upload.

Keyboard shortcuts in the player: `Space/K` play, `←/→` seek 5s, `J/L` seek 10s, `↑/↓` volume, `M` mute, `F` fullscreen, `P` prime, `R` reload, `D` downloads, `0–9` jump, `?` shortcuts.

---

## Why the referrer rule?

Since late 2025 YouTube's embedded player rejects requests without a valid HTTP `Referer` (errors **152/153**). Chrome extension pages do not send a referrer, so an embed from a `chrome-extension://` page is refused.

LagFree includes a scoped `declarativeNetRequest` rule (`rules.json`) that sets

```
Referer: https://example.com
```

only for requests whose URL contains `lagfree=1` — i.e. only LagFree's own YouTube embeds. It does not alter other websites' embeds or other YouTube pages, and it is not used to bypass ads.

If YouTube changes this policy, playback may fail with 152/153. Reload the extension and the player tab.

---

## Why the helper?

Browser extensions cannot turn YouTube's signed, segmented streams into a normal saveable file by themselves. The helper does the extraction and muxing locally with yt-dlp + ffmpeg. It supports high-quality video and audio, reliable cancellation and correct file output.

The helper is **not** a server. It is a native messaging process launched by the browser only for a download or a quick health check. The extension and helper communicate over Chrome's native-messaging pipe, and the native-host manifest only allows this extension ID.

### What it does not do

- No DRM-protected content.
- No ads bypass.
- No live recording.
- No uploading, telemetry or accounts.
- No guarantee for private, members-only or age-gated videos; those may need yt-dlp cookies, which this UI does not configure.

---

## Troubleshooting

| Symptom | Try |
| --- | --- |
| “Helper not installed” | Run `bash ~/my_extensions/lagfree-player/companion/setup.sh`, reload the extension, then restart the browser if needed. |
| Extension id forbidden | You moved the extension or loaded a different copy. Re-run setup from the current folder, or pass `--extension-id ID`. |
| Snap Brave says helper not installed | Snap keeps config in `~/snap/brave/<revision>/.config/...`. Re-run this version of setup and **restart Brave**; the script installs the manifest there. |
| ffmpeg missing | Install it (e.g. `sudo apt install ffmpeg`) and click **Check helper**. |
| yt-dlp too old | Re-run setup; it updates the venv. |
| Download fails | Read the error in Downloads. Retry; for unavailable/private videos, open on YouTube. |
| Error 152 / 153 | Reload the extension and player tab. Make sure the referrer rule is enabled. |
| Still stuttering | Use 720p/480p, keep Force H.264 on, close other tabs, check hardware acceleration. |
| Autoplay blocked | Click the big play button. Browsers block unmuted autoplay. |
| No sound | Click the speaker icon; check **Start muted** in Settings. |
| Video unavailable | The owner may not allow embedding. Use **Open on YouTube**. |
| H.264 causes an error | Turn **Force H.264** off in Settings, then press `R` or reload. |
| Settings/History while playing | Switching views in place keeps playback alive. |

---

## Privacy

- Video IDs, titles, queue, history, downloads list and settings live in `chrome.storage.local`.
- The extension talks to YouTube (embed + oEmbed metadata) and to the local helper over native messaging.
- The helper talks to YouTube for the download and writes to `~/Downloads/LagFree`.
- No account, analytics, telemetry or remote server.
- The header rule only sets a generic referrer for LagFree's own embed requests.

---

## Project layout

```
manifest.json          MV3 manifest
background.js          menus, command, player routing, download jobs
rules.json             scoped referrer rule for YouTube embeds
popup/                 toolbar popup (detect, open, queue, download, copy)
player/                the custom site:
  player.html/css/js   shell, views, controls, queue/history/downloads/settings
  yt-bridge.js         postMessage bridge to the YouTube embed
  codec-guard.js       H.264 nudge (LagFree embeds only)
  embed-scope.js       marks LagFree's embed for scoped CSS
  embed.css            hides the embed's own chrome
companion/
  setup.sh             installs native host + yt-dlp venv
  run.sh               native messaging launcher
  lagfree_downloader.py  yt-dlp progress/cancel/open-folder host
shared/                theme, icons, settings, storage, utilities
icons/                 toolbar icons
```

Bundled font: **Inter** (SIL Open Font License 1.1). See `shared/INTER-LICENSE.txt`.

Version 1.1.1 — not affiliated with YouTube or Google.
