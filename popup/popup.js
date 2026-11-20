import { paintIcons, setIcon } from "../shared/icons.js";
import {
  parseVideo,
  stripYouTubeTitle,
  thumbnailUrl,
  watchUrl,
  formatRelative,
} from "../shared/utils.js";
import { getSettings, saveSettings, qualityLabel } from "../shared/settings.js";
import { fetchVideoMeta } from "../shared/meta.js";
import { getStored } from "../shared/storage.js";

const state = {
  tab: null,
  video: null,
  meta: null,
  settings: null,
  history: [],
  view: "empty",
  opening: false,
};

const content = document.getElementById("content");
const toastEl = document.getElementById("toast");
let toastTimer = 0;

init().catch((error) => {
  console.error("[LagFree popup]", error);
  renderEmpty();
});

async function init() {
  paintIcons();
  document.getElementById("version").textContent = `v${safeVersion()}`;

  const settings = await getSettings();
  state.settings = settings;
  syncToggles();

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tab = tabs && tabs[0] ? tabs[0] : null;
  } catch {
    state.tab = null;
  }

  const parsed = state.tab && state.tab.url ? parseVideo(state.tab.url) : null;

  try {
    const stored = await getStored("history");
    state.history = Array.isArray(stored.history) ? stored.history : [];
  } catch {
    state.history = [];
  }

  if (parsed) {
    state.video = parsed;
    state.view = "detected";
    renderDetected();
    setStatus("Video found", "green");
    hydrateMeta(parsed.id);
  } else {
    state.view = "empty";
    renderEmpty();
    setStatus("Pick a video", "blurple");
  }

  bindFooter();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") window.close();
  });
}

function safeVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "1.0.0";
  }
}

function bindFooter() {
  document.getElementById("toggle-h264").addEventListener("change", async (event) => {
    state.settings = await saveSettings({ forceH264: event.target.checked });
    updateEngineBadge();
    toast(event.target.checked ? "H.264 boost on — lighter decode" : "H.264 boost off — YouTube picks the codec", "good");
  });
  document.getElementById("toggle-adaptive").addEventListener("change", async (event) => {
    state.settings = await saveSettings({ adaptiveQuality: event.target.checked });
    toast(event.target.checked ? "Adaptive quality on" : "Adaptive quality off");
  });
  document.getElementById("settings").addEventListener("click", () => {
    openView("settings");
  });
}

function syncToggles() {
  if (!state.settings) return;
  document.getElementById("toggle-h264").checked = Boolean(state.settings.forceH264);
  document.getElementById("toggle-adaptive").checked = Boolean(state.settings.adaptiveQuality);
}

/* ------------------------------------------------------------------ */
/* Render: detected video                                              */
/* ------------------------------------------------------------------ */

function renderDetected() {
  if (!state.video) return;
  content.replaceChildren();

  const card = make("section", "video-card");

  const thumb = make("div", "thumb");
  thumb.tabIndex = 0;
  thumb.setAttribute("role", "button");
  thumb.setAttribute("aria-label", "Open this video in the LagFree player");
  thumb.addEventListener("click", () => openCurrent());
  thumb.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCurrent();
    }
  });

  const img = make("img");
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  img.src = state.meta?.thumbnail || thumbnailUrl(state.video.id, "mqdefault");
  img.addEventListener("error", () => {
    if (!img.src.includes("hqdefault")) img.src = thumbnailUrl(state.video.id, "hqdefault");
    else thumb.classList.add("failed");
  });

  const fallback = make("div", "thumb-fallback");
  fallback.append(iconSpan("play"));

  const source = make("span", "source-pill");
  const ytDot = make("span", "yt-dot");
  source.append(ytDot, document.createTextNode("YOUTUBE"));

  const play = make("span", "thumb-play");
  play.append(iconSpan("play"));

  thumb.append(img, fallback, source, play);
  card.append(thumb);

  const metaBox = make("div", "video-meta");
  const title = make("h1", "video-title", videoTitle());
  const channel = make("p", "video-channel", channelName());
  metaBox.append(title, channel);
  card.append(metaBox);
  content.append(card);

  const engine = make("div", "engine");
  engine.append(make("span", "dot green"));
  const engineText = make("span", "engine-text", engineCopy());
  const badge = make("span", "engine-badge", engineBadgeCopy());
  badge.id = "engine-badge";
  engine.append(engineText, badge);
  content.append(engine);

  const open = make("button", "btn primary big");
  open.type = "button";
  open.id = "open";
  open.append(document.createTextNode("Open LagFree Player"), iconSpan("arrow-right"));
  open.addEventListener("click", () => openCurrent());
  content.append(open);

  const split = make("div", "split");
  const queue = make("button", "btn subtle");
  queue.type = "button";
  queue.id = "queue";
  queue.append(iconSpan("plus"), document.createTextNode("Queue"));
  queue.addEventListener("click", () => queueCurrent(queue));
  const copy = make("button", "btn subtle");
  copy.type = "button";
  copy.append(iconSpan("copy"), document.createTextNode("Copy link"));
  copy.addEventListener("click", () => copyCurrent());
  split.append(queue, copy);
  content.append(split);

  const another = make("button", "text-link");
  another.type = "button";
  another.append(document.createTextNode("Open a different link"), iconSpan("chevron-right"));
  another.addEventListener("click", () => {
    state.view = "empty";
    setStatus("Paste a link", "blurple");
    renderEmpty({ autofocus: true });
  });
  content.append(another);

  paintIcons(content);
}

async function hydrateMeta(id) {
  const meta = await fetchVideoMeta(id);
  if (!meta || !state.video || state.video.id !== id) return;
  state.meta = meta;
  const title = content.querySelector(".video-title");
  const channel = content.querySelector(".video-channel");
  const img = content.querySelector(".thumb img");
  if (title) title.textContent = meta.title || title.textContent;
  if (channel) channel.textContent = meta.author || channel.textContent;
  if (img && meta.thumbnail) img.src = meta.thumbnail;
}

function videoTitle() {
  return state.meta?.title || stripYouTubeTitle(state.tab?.title) || "YouTube video";
}

function channelName() {
  return state.meta?.author || "YouTube";
}

function engineCopy() {
  const seconds = Number(state.settings?.prebufferSeconds) || 0;
  return seconds > 0 ? `Pre-buffer ${seconds}s · engine ready` : "Direct streaming · engine ready";
}

function engineBadgeCopy() {
  const quality = qualityLabel(state.settings?.quality || "hd720");
  const codec = state.settings?.forceH264 ? "H.264" : "Auto codec";
  return `${quality} · ${codec}`;
}

function updateEngineBadge() {
  const badge = document.getElementById("engine-badge");
  if (badge) badge.textContent = engineBadgeCopy();
  const engineText = content.querySelector(".engine-text");
  if (engineText) engineText.textContent = engineCopy();
}

/* ------------------------------------------------------------------ */
/* Render: paste a link                                                */
/* ------------------------------------------------------------------ */

function renderEmpty({ autofocus = true } = {}) {
  content.replaceChildren();
  state.view = "empty";

  const wrap = make("section", "empty");
  const hero = make("div", "empty-hero");
  hero.append(iconSpan("monitor"));
  wrap.append(hero);

  wrap.append(make("h1", null, "Play YouTube without the lag."));

  const onYouTube = Boolean(state.tab?.url && /(^|\.)youtube\.com|youtu\.be/i.test(state.tab.url));
  const lede = make(
    "p",
    "lede",
    onYouTube
      ? "This tab isn’t a video. Paste a watch, Shorts or live link and LagFree will open it in a lean, pre-buffered player."
      : "Paste any YouTube link. LagFree opens it in a lean, pre-buffered player built for laptops that struggle with the full site."
  );
  wrap.append(lede);

  const form = make("form", "url-form");
  form.append(iconSpan("search"));
  const input = make("input");
  input.type = "text";
  input.id = "url";
  input.placeholder = "Paste a YouTube link…";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "YouTube link");
  const go = make("button", "go");
  go.type = "submit";
  go.disabled = true;
  go.setAttribute("aria-label", "Open in LagFree Player");
  go.append(iconSpan("arrow-right"));
  form.append(input, go);
  wrap.append(form);

  const hint = make("p", "paste-hint");
  hint.append(
    document.createTextNode("Paste a link or type a video ID · "),
    make("kbd", null, "Enter"),
    document.createTextNode(" to play")
  );
  wrap.append(hint);

  const features = make("div", "features");
  features.append(
    feature("zap", "blurple", "Pre-buffer", "Starts smooth"),
    feature("cpu", "green", "H.264 boost", "Easier decode"),
    feature("gauge", "yellow", "Lag guard", "Auto quality")
  );
  wrap.append(features);

  if (state.history.length) {
    const recent = make("div", "recent");
    const label = make("div", "recent-label");
    label.append(make("span", null, "RECENT"));
    const historyBtn = make("button", null, "Open library");
    historyBtn.type = "button";
    historyBtn.addEventListener("click", () => openView("history"));
    label.append(historyBtn);
    recent.append(label);

    for (const entry of state.history.slice(0, 2)) {
      const row = make("button", "recent-row");
      row.type = "button";
      const thumb = make("img", "recent-thumb");
      thumb.alt = "";
      thumb.referrerPolicy = "no-referrer";
      thumb.src = entry.thumbnail || thumbnailUrl(entry.id, "mqdefault");
      const copy = make("span", "recent-copy");
      copy.append(make("span", "recent-title", entry.title || "YouTube video"));
      copy.append(
        make("span", "recent-meta", `${entry.author || "YouTube"} · ${entry.lastPlayedAt ? formatRelative(entry.lastPlayedAt) : "recently"}`)
      );
      row.append(thumb, copy);
      row.addEventListener("click", () => {
        openVideo({ id: entry.id, start: Number(entry.start) || 0 }, { title: entry.title || "", author: entry.author || "" });
      });
      recent.append(row);
    }
    wrap.append(recent);
  }

  content.append(wrap);
  paintIcons(content);

  input.addEventListener("input", () => {
    form.classList.remove("invalid");
    const parsed = parseVideo(input.value);
    go.disabled = !parsed;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const parsed = parseVideo(input.value);
    if (!parsed) {
      form.classList.add("invalid");
      setTimeout(() => form.classList.remove("invalid"), 400);
      input.focus();
      toast("That doesn’t look like a YouTube link", "bad");
      return;
    }
    openVideo(parsed, null, { button: go });
  });

  if (autofocus) {
    setTimeout(() => input.focus(), 30);
  }
}

function feature(iconName, tone, title, subtitle) {
  const box = make("div", "feature");
  const ico = make("div", `feature-ico ${tone}`);
  ico.append(iconSpan(iconName));
  box.append(ico, make("b", null, title), make("span", null, subtitle));
  return box;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function openCurrent() {
  if (!state.video) return;
  openVideo(state.video, state.meta);
}

async function openVideo(video, meta, { button = null } = {}) {
  if (!video || !video.id || state.opening) return;
  state.opening = true;
  if (button) {
    button.classList.add("busy");
    setIcon(button, "refresh");
  }
  const primary = document.getElementById("open");
  if (primary) primary.classList.add("busy");

  const payload = {
    type: "open-player",
    video: { id: video.id, start: Number(video.start) || 0 },
    meta: meta?.title ? { title: meta.title, author: meta.author || "" } : null,
  };

  let opened = false;
  try {
    const response = await chrome.runtime.sendMessage(payload);
    opened = response?.ok === true;
  } catch {
    opened = false;
  }

  if (!opened) {
    try {
      const url = playerUrl(video);
      if (chrome?.tabs?.create) await chrome.tabs.create({ url });
      else window.location.href = url;
      opened = true;
    } catch {
      opened = false;
    }
  }

  if (opened) {
    window.close();
    return;
  }

  state.opening = false;
  if (button) {
    button.classList.remove("busy");
    setIcon(button, "arrow-right");
  }
  if (primary) primary.classList.remove("busy");
  toast("Couldn’t open the player. Try again.", "bad");
}

function playerUrl(video, view = "") {
  const base = chrome.runtime.getURL("player/player.html");
  const url = new URL(base);
  if (video?.id) {
    url.searchParams.set("video", video.id);
    if (Number(video.start) > 0) url.searchParams.set("t", String(Math.floor(video.start)));
  }
  if (view) url.searchParams.set("view", view);
  return url.toString();
}

async function openView(view) {
  if (state.opening) return;
  state.opening = true;
  const video = state.video ? { id: state.video.id, start: state.video.start } : null;
  try {
    const response = await chrome.runtime.sendMessage({ type: "open-player", video, view });
    if (response?.ok === true) {
      window.close();
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    const url = playerUrl(video, view);
    if (chrome?.tabs?.create) await chrome.tabs.create({ url });
    else window.location.href = url;
    window.close();
  } catch {
    state.opening = false;
    toast("Couldn’t open settings", "bad");
  }
}

async function queueCurrent(button) {
  if (!state.video) return;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "queue-add",
      video: { id: state.video.id, start: state.video.start },
      meta: state.meta ? { title: state.meta.title, author: state.meta.author } : null,
    });
    if (response?.ok !== true) throw new Error(response?.error || "queue failed");
    button.classList.add("queued");
    button.replaceChildren(iconSpan("check"), document.createTextNode("Queued"));
    paintIcons(button);
    toast("Added to the play queue", "good");
  } catch {
    toast("Couldn’t add to the queue", "bad");
  }
}

async function copyCurrent() {
  if (!state.video) return;
  const url = watchUrl(state.video.id, state.video.start || 0);
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied", "good");
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = url;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      toast("Link copied", "good");
    } catch {
      toast("Copy failed", "bad");
    }
  }
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function iconSpan(name) {
  const span = make("span");
  span.dataset.icon = name;
  return span;
}

function setStatus(text, tone = "green") {
  const dot = document.getElementById("status-dot");
  const label = document.getElementById("status-text");
  if (label) label.textContent = text;
  if (dot) {
    dot.className = `dot ${tone}`;
    if (tone === "green") dot.classList.add("pulse");
  }
}

function toast(message, tone = "") {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = `toast show${tone ? " " + tone : ""}`;
  toastTimer = setTimeout(() => {
    toastEl.className = `toast${tone ? " " + tone : ""}`;
  }, 2200);
}
