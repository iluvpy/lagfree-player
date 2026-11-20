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

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const stored = await chrome.storage.local.get(["settings", "history", "queue"]);
    const patch = {};
    if (!stored.settings) patch.settings = { ...DEFAULT_SETTINGS };
    else {
      const normalized = normalizeSettings(stored.settings);
      if (JSON.stringify(normalized) !== JSON.stringify(stored.settings)) patch.settings = normalized;
    }
    if (!Array.isArray(stored.history)) patch.history = [];
    if (!Array.isArray(stored.queue)) patch.queue = [];
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  } catch {
    /* ignore */
  }
  createMenus();
});

chrome.runtime.onStartup.addListener(createMenus);

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    // Reading lastError prevents noisy "duplicate id" warnings during updates.
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "open-player") {
    openPlayer(message.video || null, message.meta || null, { view: message.view })
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
  return undefined;
});

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

async function openPlayer(video = null, meta = null, { view = "" } = {}) {
  const base = chrome.runtime.getURL(PLAYER_PATH);
  const url = new URL(base);
  if (video?.id) {
    url.searchParams.set("video", video.id);
    if (Number(video.start) > 0) url.searchParams.set("t", String(Math.floor(video.start)));
  }
  if (meta?.title) url.searchParams.set("title", String(meta.title).slice(0, 200));
  if (meta?.author) url.searchParams.set("author", String(meta.author).slice(0, 120));
  if (view) url.searchParams.set("view", view);

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

    // Same video + only a view change: keep playback alive by switching views
    // in place instead of reloading the whole player tab.
    if (sameVideo && !sameView) {
      try {
        await chrome.tabs.sendMessage(existing.id, { type: "switch-view", view: view || "player" });
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

function flashBadge(text, color) {
  try {
    chrome.action.setBadgeBackgroundColor({ color });
    chrome.action.setBadgeText({ text });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1600);
  } catch {
    /* ignore */
  }
}
