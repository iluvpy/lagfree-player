import { parseVideo } from "./shared/utils.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "./shared/settings.js";
import { fetchVideoMeta } from "./shared/meta.js";

const PLAYER_PATH = "player/player.html";
const LINK_PATTERNS = [
  "*://*.youtube.com/*",
  "*://youtu.be/*",
  "*://*.youtube-nocookie.com/*",
];

const MENU = {
  page: "lagfree-open-page",
  link: "lagfree-play-link",
  queue: "lagfree-queue-link",
};

const DOWNLOAD_HOST = "com.lagfree.downloader";
const DOWNLOADS_KEY = "downloads";
const MAX_DOWNLOADS = 50;
const ACTIVE_STATUSES = new Set(["starting", "downloading", "processing", "cancelling"]);
const TERMINAL_STATUSES = new Set(["complete", "error", "cancelled", "interrupted"]);
const DOWNLOAD_QUALITIES = new Set(["720", "1080", "best", "audio"]);
const QUALITY_LABELS = {
  720: "720p MP4",
  1080: "1080p MP4",
  best: "Best (MKV)",
  audio: "Audio only (M4A)",
};

let downloads = [];
let downloadsReady = loadDownloads();
let persistChain = Promise.resolve();
const activeDownloadPorts = new Map();

/* ================================================================== */
/* Install / menus                                                     */
/* ================================================================== */

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const stored = await chrome.storage.local.get(["settings", "history", "queue", DOWNLOADS_KEY]);
    const patch = {};
    if (!stored.settings) patch.settings = { ...DEFAULT_SETTINGS };
    else {
      const normalized = normalizeSettings(stored.settings);
      if (JSON.stringify(normalized) !== JSON.stringify(stored.settings)) patch.settings = normalized;
    }
    if (!Array.isArray(stored.history)) patch.history = [];
    if (!Array.isArray(stored.queue)) patch.queue = [];
    if (!Array.isArray(stored[DOWNLOADS_KEY])) patch[DOWNLOADS_KEY] = [];
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  } catch {
    /* ignore */
  }
  createMenus();
});

chrome.runtime.onStartup.addListener(createMenus);

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create({
      id: MENU.page,
      title: "Open in LagFree Player",
      contexts: ["page"],
      documentUrlPatterns: ["*://*.youtube.com/*"],
    });
    chrome.contextMenus.create({
      id: MENU.link,
      title: "Play YouTube link in LagFree",
      contexts: ["link"],
      targetUrlPatterns: LINK_PATTERNS,
    });
    chrome.contextMenus.create({
      id: MENU.queue,
      title: "Add YouTube link to LagFree queue",
      contexts: ["link"],
      targetUrlPatterns: LINK_PATTERNS,
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const source = info.menuItemId === MENU.page ? info.pageUrl || tab?.url : info.linkUrl || info.pageUrl || tab?.url;
  const video = parseVideo(source);
  if (!video) {
    flashBadge("!", "#f23f43");
    return;
  }
  if (info.menuItemId === MENU.queue) {
    await addToQueue(video);
    flashBadge("✓", "#23a55a");
    return;
  }
  await openPlayer(video);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-lagfree") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const video = parseVideo(tab?.url);
  await openPlayer(video);
});

/* ================================================================== */
/* Messages                                                           */
/* ================================================================== */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return undefined;
  if (message.type === "open-player") {
    openPlayer(message.video || null, message.meta || null, {
      view: message.view,
      download: Boolean(message.download),
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "queue-add") {
    addToQueue(message.video, message.meta)
      .then((queue) => sendResponse({ ok: true, count: queue.length }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "download-start") {
    startDownload(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "download-cancel") {
    cancelDownload(message.jobId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "download-remove") {
    removeDownload(message.jobId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "downloads-clear") {
    clearFinishedDownloads()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "download-open-folder") {
    openDownloadFolder(message.path)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "downloader-test") {
    testDownloader()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return undefined;
});

/* ================================================================== */
/* Queue                                                              */
/* ================================================================== */

async function addToQueue(video, meta = null) {
  if (!video?.id) throw new Error("Missing video id");
  const stored = await chrome.storage.local.get("queue");
  const queue = Array.isArray(stored.queue) ? stored.queue : [];
  if (!queue.some((entry) => entry.id === video.id)) {
    const info = meta?.title ? meta : await fetchVideoMeta(video.id, { timeout: 2500 });
    queue.unshift({
      id: video.id,
      title: info?.title || "",
      author: info?.author || "",
      addedAt: Date.now(),
      start: Number(video.start) || 0,
    });
    await chrome.storage.local.set({ queue: queue.slice(0, 60) });
  }
  return queue;
}

/* ================================================================== */
/* Player routing                                                     */
/* ================================================================== */

async function openPlayer(video = null, meta = null, { view = "", download = false } = {}) {
  const base = chrome.runtime.getURL(PLAYER_PATH);
  const url = new URL(base);
  if (video?.id) {
    url.searchParams.set("video", video.id);
    if (Number(video.start) > 0) url.searchParams.set("t", String(Math.floor(video.start)));
  }
  if (meta?.title) url.searchParams.set("title", String(meta.title).slice(0, 200));
  if (meta?.author) url.searchParams.set("author", String(meta.author).slice(0, 120));
  if (view) url.searchParams.set("view", view);
  if (download) url.searchParams.set("download", "1");

  const allTabs = await chrome.tabs.query({});
  const existing = allTabs.find((tab) => typeof tab.url === "string" && tab.url.startsWith(base));
  if (existing && !video?.id) {
    // Opening settings/history from the popup shouldn't stop whatever is playing.
    try {
      const current = new URL(existing.url);
      const currentVideo = current.searchParams.get("video");
      if (currentVideo) {
        url.searchParams.set("video", currentVideo);
        const currentT = current.searchParams.get("t");
        if (currentT) url.searchParams.set("t", currentT);
      }
    } catch {
      /* ignore */
    }
  }
  const target = url.toString();

  if (existing) {
    let sameVideo = false;
    let sameView = false;
    let activeView = "player";
    try {
      const current = new URL(existing.url);
      sameVideo =
        current.searchParams.get("video") === url.searchParams.get("video") &&
        (current.searchParams.get("t") || "") === (url.searchParams.get("t") || "");
      activeView = current.searchParams.get("view") || "player";
      sameView = activeView === (view || "player");
    } catch {
      sameVideo = false;
    }

    // Same video + just a view change/download: keep playback alive and use the
    // live player page instead of reloading the whole tab.
    if (sameVideo && (!sameView || download)) {
      try {
        if (!sameView) {
          await chrome.tabs.sendMessage(existing.id, { type: "switch-view", view: view || "player" });
        }
        if (download) {
          await chrome.tabs.sendMessage(existing.id, { type: "open-download" });
        }
        await chrome.tabs.update(existing.id, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
        return existing.id;
      } catch {
        /* fall through to a full navigation */
      }
    }

    if (!sameVideo || !sameView) await chrome.tabs.update(existing.id, { url: target, active: true });
    else await chrome.tabs.update(existing.id, { active: true });
    try {
      await chrome.windows.update(existing.windowId, { focused: true });
    } catch {
      /* window may be gone */
    }
    return existing.id;
  }

  const created = await chrome.tabs.create({ url: target, active: true });
  return created.id;
}

/* ================================================================== */
/* Download jobs                                                     */
/* ================================================================== */

async function loadDownloads() {
  try {
    const stored = await chrome.storage.local.get(DOWNLOADS_KEY);
    const list = Array.isArray(stored[DOWNLOADS_KEY]) ? stored[DOWNLOADS_KEY] : [];
    const now = Date.now();
    let changed = false;
    for (const job of list) {
      if (!job || typeof job !== "object") continue;
      if (ACTIVE_STATUSES.has(job.status)) {
        job.status = "interrupted";
        job.error = "The browser or downloader helper stopped before this finished.";
        job.updatedAt = now;
        changed = true;
      }
    }
    downloads = list.filter((job) => job && typeof job === "object");
    if (changed) {
      persistChain = persistChain.then(() => chrome.storage.local.set({ [DOWNLOADS_KEY]: downloads }));
      await persistChain;
    }
    return downloads;
  } catch {
    downloads = [];
    return downloads;
  }
}

async function ensureDownloads() {
  await downloadsReady;
  return downloads;
}

function persistDownloads() {
  const snapshot = downloads.map((job) => ({ ...job }));
  persistChain = persistChain
    .catch(() => {})
    .then(() => chrome.storage.local.set({ [DOWNLOADS_KEY]: snapshot }));
  return persistChain;
}

async function getDownload(jobId) {
  await ensureDownloads();
  return downloads.find((job) => job.id === jobId) || null;
}

async function updateDownload(jobId, patch) {
  const job = await getDownload(jobId);
  if (!job) return null;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) job[key] = value;
  }
  job.updatedAt = Date.now();
  await persistDownloads();
  return job;
}

function trimDownloads() {
  while (downloads.length > MAX_DOWNLOADS) {
    let index = -1;
    for (let i = downloads.length - 1; i >= 0; i -= 1) {
      if (TERMINAL_STATUSES.has(downloads[i].status)) {
        index = i;
        break;
      }
    }
    if (index === -1) break;
    downloads.splice(index, 1);
  }
}

async function startDownload(message) {
  await ensureDownloads();
  const videoId = String(message.videoId || "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return { ok: false, error: "That video id is not valid." };
  }
  const quality = DOWNLOAD_QUALITIES.has(message.quality) ? message.quality : "1080";
  const jobId = `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();
  const job = {
    id: jobId,
    videoId,
    title: String(message.title || "").slice(0, 300),
    author: String(message.author || "").slice(0, 160),
    thumbnail: String(message.thumbnail || ""),
    quality,
    qualityLabel: QUALITY_LABELS[quality],
    status: "starting",
    stage: "Starting helper",
    percent: 0,
    speed: null,
    eta: null,
    downloadedBytes: 0,
    totalBytes: 0,
    path: "",
    filename: "",
    filesize: 0,
    error: "",
    createdAt: now,
    updatedAt: now,
  };
  downloads.unshift(job);
  trimDownloads();
  await persistDownloads();

  try {
    const port = chrome.runtime.connectNative(DOWNLOAD_HOST);
    const entry = { port, terminal: false };
    activeDownloadPorts.set(jobId, entry);
    port.onMessage.addListener((nativeMessage) => {
      if (nativeMessage && typeof nativeMessage === "object") {
        void handleNativeDownloadMessage(jobId, nativeMessage);
      }
    });
    port.onDisconnect.addListener(() => handleNativeDisconnect(jobId));
    port.postMessage({
      type: "start",
      jobId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      quality,
    });
    return { ok: true, jobId, job };
  } catch (error) {
    const friendly = friendlyNativeError(error?.message);
    await updateDownload(jobId, { status: "error", error: friendly });
    return { ok: false, error: friendly, jobId };
  }
}

async function handleNativeDownloadMessage(jobId, message) {
  const entry = activeDownloadPorts.get(jobId);
  if (!entry) return;
  const type = message.type;
  if (type === "status") {
    await updateDownload(jobId, {
      status: message.status === "downloading" ? "downloading" : "starting",
      stage: message.stage || "Preparing",
      qualityLabel: message.qualityLabel || undefined,
    });
    return;
  }
  if (type === "progress") {
    const percent = Number(message.percent);
    await updateDownload(jobId, {
      status: "downloading",
      stage: message.stage === "audio" ? "Downloading audio" : "Downloading video",
      percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0,
      downloadedBytes: Number(message.downloadedBytes) || 0,
      totalBytes: Number(message.totalBytes) || 0,
      speed: Number(message.speed) || 0,
      eta: Number.isFinite(Number(message.eta)) ? Number(message.eta) : null,
      title: message.title ? String(message.title).slice(0, 300) : undefined,
    });
    return;
  }
  if (type === "processing") {
    await updateDownload(jobId, {
      status: "processing",
      stage: message.stage === "Merger" ? "Merging audio + video" : message.stage || "Processing",
      percent: 100,
      speed: 0,
      eta: null,
    });
    return;
  }
  if (type === "done") {
    entry.terminal = true;
    await updateDownload(jobId, {
      status: "complete",
      stage: "Saved",
      percent: 100,
      speed: 0,
      eta: 0,
      path: String(message.path || ""),
      filename: String(message.filename || ""),
      filesize: Number(message.filesize) || 0,
      title: message.title ? String(message.title).slice(0, 300) : undefined,
      duration: Number(message.duration) || 0,
      qualityLabel: message.qualityLabel || undefined,
    });
    return;
  }
  if (type === "error") {
    entry.terminal = true;
    await updateDownload(jobId, {
      status: "error",
      error: friendlyNativeError(message.error),
      stage: "Failed",
    });
    return;
  }
  if (type === "cancelled") {
    entry.terminal = true;
    await updateDownload(jobId, {
      status: "cancelled",
      stage: "Cancelled",
      speed: 0,
      eta: null,
    });
  }
}

async function handleNativeDisconnect(jobId) {
  const lastError = chrome.runtime.lastError?.message || "";
  const entry = activeDownloadPorts.get(jobId);
  activeDownloadPorts.delete(jobId);
  if (!entry || entry.terminal) return;
  const job = await getDownload(jobId);
  if (!job) return;
  if (job.status === "cancelling") {
    await updateDownload(jobId, { status: "cancelled", stage: "Cancelled", speed: 0, eta: null });
    return;
  }
  if (TERMINAL_STATUSES.has(job.status)) return;
  await updateDownload(jobId, {
    status: "error",
    stage: "Failed",
    error: friendlyNativeError(lastError || "The downloader helper disconnected."),
    speed: 0,
    eta: null,
  });
}

async function cancelDownload(jobId) {
  await ensureDownloads();
  const job = downloads.find((item) => item.id === jobId);
  if (!job) return { ok: false, error: "Download not found." };
  if (TERMINAL_STATUSES.has(job.status)) return { ok: true };
  const entry = activeDownloadPorts.get(jobId);
  if (entry) {
    try {
      entry.port.postMessage({ type: "cancel", jobId });
      await updateDownload(jobId, { status: "cancelling", stage: "Cancelling" });
      return { ok: true };
    } catch {
      /* fall through */
    }
  }
  await updateDownload(jobId, { status: "cancelled", stage: "Cancelled" });
  return { ok: true };
}

async function removeDownload(jobId) {
  await ensureDownloads();
  const job = downloads.find((item) => item.id === jobId);
  if (!job) return { ok: true };
  if (ACTIVE_STATUSES.has(job.status)) return { ok: false, error: "Cancel this download before removing it." };
  downloads = downloads.filter((item) => item.id !== jobId);
  await persistDownloads();
  return { ok: true };
}

async function clearFinishedDownloads() {
  await ensureDownloads();
  downloads = downloads.filter((job) => ACTIVE_STATUSES.has(job.status));
  await persistDownloads();
  return { ok: true, count: downloads.length };
}

/* ================================================================== */
/* Native helper                                                      */
/* ================================================================== */

function friendlyNativeError(raw) {
  const message = String(raw || "").trim();
  if (!message) return "The downloader helper disconnected.";
  if (/native messaging host not found|not registered|host not found/i.test(message)) {
    return "The downloader helper isn't installed. Run companion/setup.sh, then reload the extension.";
  }
  if (/forbidden|not allowed|access to the specified native messaging host/i.test(message)) {
    return "The helper is installed but this extension ID isn't allowed. Re-run companion/setup.sh and reload LagFree.";
  }
  return message;
}

function testDownloader() {
  return new Promise((resolve) => {
    let port = null;
    let settled = false;
    let timer = 0;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        port?.disconnect();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    try {
      port = chrome.runtime.connectNative(DOWNLOAD_HOST);
    } catch (error) {
      finish({ ok: false, error: friendlyNativeError(error?.message) });
      return;
    }
    timer = setTimeout(() => {
      finish({ ok: false, error: "The downloader helper did not respond. Reload the extension and try again." });
    }, 5000);
    port.onMessage.addListener((message) => {
      if (!message || message.type !== "pong") return;
      const info = {
        ok: !message.error,
        error: message.error || "",
        version: message.version || "",
        ytdlp: message.ytdlp || "",
        ffmpeg: Boolean(message.ffmpeg),
        ffmpegPath: message.ffmpegPath || "",
        outputDir: message.outputDir || "",
        python: message.python || "",
      };
      finish(info);
    });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message;
      if (!settled) finish({ ok: false, error: friendlyNativeError(error) });
    });
    try {
      port.postMessage({ type: "ping" });
    } catch (error) {
      finish({ ok: false, error: friendlyNativeError(error?.message) });
    }
  });
}

function openDownloadFolder(path) {
  return new Promise((resolve) => {
    let port = null;
    let settled = false;
    let timer = 0;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        port?.disconnect();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    if (typeof path !== "string" || !path) {
      resolve({ ok: false, error: "No download folder path." });
      return;
    }
    try {
      port = chrome.runtime.connectNative(DOWNLOAD_HOST);
    } catch (error) {
      finish({ ok: false, error: friendlyNativeError(error?.message) });
      return;
    }
    timer = setTimeout(() => finish({ ok: false, error: "Could not reach the downloader helper." }), 4000);
    port.onMessage.addListener((message) => {
      if (message?.type === "opened") finish({ ok: true });
      else if (message?.type === "error") finish({ ok: false, error: friendlyNativeError(message.error) });
    });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message;
      if (!settled) finish({ ok: false, error: friendlyNativeError(error) });
    });
    try {
      port.postMessage({ type: "open-folder", path });
    } catch (error) {
      finish({ ok: false, error: friendlyNativeError(error?.message) });
    }
  });
}

/* ================================================================== */
/* Badge                                                              */
/* ================================================================== */

function flashBadge(text, color) {
  try {
    chrome.action.setBadgeBackgroundColor({ color });
    chrome.action.setBadgeText({ text });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1600);
  } catch {
    /* ignore */
  }
}
