# LagFree — Smooth YouTube Player (AI generated)

A Discord-dark Chrome/Brave extension that takes the video you are already watching and opens it in a lean, pre-buffered player page.

The popup detects the current YouTube video. Click **Open LagFree Player** and a local extension page loads the video in YouTube's lightweight embedded player, with a custom shell, play queue, history, quality cap, H.264 boost and a lag guard.

> LagFree is a **pre-buffer + lightweight player**, not a video downloader. Browser extensions cannot legally or technically download YouTube streams. It gives YouTube's own stream a head start, removes the watch-page weight, and reduces decode work. See [Why not download?](#why-not-download-the-video).

---

## Install (Chrome, Brave, Edge)

1. Open `chrome://extensions` (Brave: `brave://extensions`).
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and choose this folder:
   `~/my_extensions/lagfree-player`
4. Pin **LagFree** to the toolbar.
5. Open any YouTube video, click the LagFree icon, then **Open LagFree Player**.

Keyboard shortcut: `Alt+Shift+L` opens the current YouTube video in LagFree.

> If you move the folder, reload the extension from `chrome://extensions`. The extension must be loaded unpacked — do not drag the ZIP into Chrome.

---

## What it does

- **Lightweight embed** — uses YouTube's `/embed/` player instead of the full watch page (no comments, recommendations, feed or heavy page scripts).
- **Pre-buffer** — plays the first few seconds muted so the initial stream has a head start; then pauses at the beginning and lets you start cleanly.
- **H.264 boost** — asks YouTube for H.264 instead of VP9/AV1, which is much easier to decode on older CPUs/GPUs.
- **Quality cap** — defaults to 720p. Quality can be changed live from the player or the popup.
- **Lag guard** — samples playback progress; if it detects repeated stalls it drops one quality step automatically.
- **Queue & history** — both stored locally in the extension.
- **Custom Discord-dark shell** — player, inspector, queue, history, settings, keyboard shortcuts and a popup that matches.
- **Works on video pages, Shorts and live URLs** (live behaviour varies).

Keyboard shortcuts in the player: `Space/K` play, `←/→` seek 5s, `J/L` seek 10s, `↑/↓` volume, `M` mute, `F` fullscreen, `P` prime, `R` reload, `0–9` jump, `?` shortcuts.

---

## Why the referrer rule?

Since late 2025 YouTube's embedded player rejects requests that do not carry a valid HTTP `Referer` (errors **152/153**). Chrome extension pages do not send a normal referrer, so an embed from a `chrome-extension://` page is refused.

LagFree includes a scoped `declarativeNetRequest` rule (`rules.json`) that sets

```
Referer: https://example.com
```

only for requests whose URL contains `lagfree=1` — i.e. only LagFree's own YouTube embeds. This is the same kind of workaround used by other embed players. It does not modify requests for other websites or other YouTube pages, and it is not used to bypass ads.

If YouTube changes this policy, playback may fail with 152/153. Try reloading the extension from `chrome://extensions` and then reloading the player tab.

The `origin` passed to the embed is the extension's own origin, so the IFrame postMessage API continues to work between the player page and the embed.

---

## Why not download the video?

YouTube streams are protected by signed URLs and are not available to an extension as a normal downloadable file. A real download needs external tooling (e.g. yt-dlp) and raises YouTube Terms of Service issues. LagFree instead:

1. starts YouTube's own stream early (pre-buffer),
2. keeps only the lightweight embed page,
3. forces a cheaper codec and a 720p cap,
4. detects stalls and steps quality down.

That combination is what removes the usual causes of stutter on an older laptop.

**Ad blockers are probably not the main cause.** The full YouTube watch page is heavy, and VP9/AV1 decoding can overwhelm older hardware. Ad blocking does not normally throttle playback intentionally. H.264 boost and the 720p cap target the hardware path; the lean embed avoids the page-weight path.

---

## Privacy

- Video IDs, titles, queue, history and settings are stored only in `chrome.storage.local` on your machine.
- The only network requests the extension makes are to YouTube: the embed itself and YouTube's public oEmbed endpoint (for video titles/channels).
- There is no account, analytics, telemetry or remote server.
- The header rule only sets a generic referrer for LagFree's own embed requests.

---

## Troubleshooting

| Symptom | Try |
| --- | --- |
| Error 152 / 153 | Reload the extension and the player tab. Make sure the extension is enabled. |
| Still stuttering | Use 720p/480p, keep **Force H.264** on, close other tabs, check hardware acceleration. |
| Autoplay blocked | Click the big play button. Browsers block unmuted autoplay. |
| No sound | Click the speaker icon; some streams start muted if **Start muted** is enabled. |
| Video unavailable | The owner may not allow embedding. Use **Open on YouTube**. |
| H.264 causes an error | Turn **Force H.264** off in Settings, then press `R` or reload the player. |
| Settings view while playing | Switching views keeps the video playing; `Alt+Shift+L` or the popup returns to the player. |

---

## Project layout

```
manifest.json          MV3 manifest
background.js          context menus, command, player-tab routing
rules.json             scoped referrer rule for YouTube embeds
popup/                 toolbar popup (detect video, open/queue/copy)
player/                the custom site:
  player.html/css/js   shell, views, controls, queue/history/settings
  yt-bridge.js         postMessage bridge to the YouTube embed
  codec-guard.js       H.264 nudge (runs only in LagFree embeds)
  embed.css            hides the embed's own chrome
shared/                theme, icons, settings, storage, utilities
icons/                 toolbar icons
```

Bundled font: **Inter** (SIL Open Font License 1.1). See `shared/INTER-LICENSE.txt`.

Not affiliated with YouTube or Google.
