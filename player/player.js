import { paintIcons, setIcon } from "../shared/icons.js";
import {
  parseVideo,
  formatTime,
  thumbnailUrl,
  watchUrl,
  friendlyQuality,
  clamp,
  waitFor,
  sleep,
  debounce,
} from "../shared/utils.js";
import {
  getSettings,
  saveSettings,
  resetSettings,
  qualityToApi,
  qualityLabel,
  loadHistoryAndQueue,
  saveHistory,
  saveQueue,
  normalizeSettings,
} from "../shared/settings.js";
import { fetchVideoMeta } from "../shared/meta.js";
import { YTPlayer } from "./yt-bridge.js";

const BUFFER_TARGET = 30;
const VIEWS = new Set(["player", "queue", "history", "settings"]);
const VIEW_LABELS = { player: "Player", queue: "Queue", history: "History", settings: "Settings" };

const $ = (id) => document.getElementById(id);

const el = {
  app: $("app"),
  stage: $("stage"),
  iframeLayer: $("iframe-layer"),
  emptyStage: $("empty-stage"),
  primeOverlay: $("prime-overlay"),
  primeTitle: $("prime-title"),
  primeSub: $("prime-sub"),
  primeEyebrow: $("prime-eyebrow"),
  primeFill: $("prime-fill"),
  primeElapsed: $("prime-elapsed"),
  primeAhead: $("prime-ahead"),
  primeSkip: $("prime-skip"),
  stageError: $("stage-error"),
  errorTitle: $("error-title"),
  errorMessage: $("error-message"),
  errorRetry: $("error-retry"),
  errorYoutube: $("error-youtube"),
  stageTop: $("stage-top"),
  stageStatePill: $("stage-state-pill"),
  stageQuality: $("stage-quality"),
  stageCodec: $("stage-codec"),
  buffering: $("buffering"),
  centerPlay: $("center-play"),
  centerLabel: $("center-label"),
  centerIcon: $("center-icon"),
  seek: $("seek"),
  seekBuffer: $("seek-buffer"),
  seekPlayed: $("seek-played"),
  seekThumb: $("seek-thumb"),
  seekTip: $("seek-tip"),
  btnPlay: $("btn-play"),
  playIcon: $("play-icon"),
  timeCurrent: $("time-current"),
  timeDuration: $("time-duration"),
  btnMute: $("btn-mute"),
  volumeIcon: $("volume-icon"),
  volume: $("volume"),
  volumeFill: $("volume-fill"),
  volumeThumb: $("volume-thumb"),
  bufferChip: $("buffer-chip"),
  bufferChipText: $("buffer-chip-text"),
  btnQuality: $("btn-quality"),
  qualityLabelEl: $("quality-label"),
  qualityMenu: $("quality-menu"),
  btnFullscreen: $("btn-fullscreen"),
  fullscreenIcon: $("fullscreen-icon"),
  underStage: $("under-stage"),
  nowEyebrow: $("now-eyebrow"),
  nowTitle: $("now-title"),
  nowAuthor: $("now-author"),
  nowId: $("now-id"),
  mini: $("mini"),
  miniThumb: $("mini-thumb"),
  miniTitle: $("mini-title"),
  miniSub: $("mini-sub"),
  miniEq: $("mini-eq"),
  btnQueue: $("btn-queue"),
  btnCopy: $("btn-copy"),
  btnOpenYt: $("btn-open-yt"),
  btnOpenYt2: $("btn-open-yt-2"),
  btnReload: $("btn-reload"),
  btnReload2: $("btn-reload-2"),
  btnPrime: $("btn-prime"),
  sidePrime: $("side-prime"),
  btnHelp: $("btn-help"),
  railHelp: $("rail-help"),
  btnShortcuts: $("btn-shortcuts"),
  btnTopSettings: $("btn-top-settings"),
  topStatus: $("top-status"),
  topDot: $("top-dot"),
  topStatusText: $("top-status-text"),
  statusDot: $("status-dot"),
  statusLine: $("status-line"),
  statusBuffer: $("status-buffer"),
  statusQuality: $("status-quality"),
  statusClock: $("status-clock"),
  crumb: $("crumb"),
  views: $("views"),
  engineStatus: $("engine-status"),
  engineDot: $("engine-dot"),
  engineStatusText: $("engine-status-text"),
  engineAhead: $("engine-ahead"),
  engineMeter: $("engine-meter"),
  inspLoaded: $("insp-loaded"),
  inspQuality: $("insp-quality"),
  inspStalls: $("insp-stalls"),
  inspCodec: $("insp-codec"),
  chipQuality: $("chip-quality"),
  chipCodec: $("chip-codec"),
  chipBuffer: $("chip-buffer"),
  chipGuard: $("chip-guard"),
  sideVersion: $("side-version"),
  aboutVersion: $("about-version"),
  queueCount: $("queue-count"),
  railQueueCount: $("rail-queue-count"),
  queueClear: $("queue-clear"),
  queueList: $("queue-list"),
  queueForm: $("queue-form"),
  queueInput: $("queue-input"),
  historyClear: $("history-clear"),
  historyList: $("history-list"),
  upNext: $("up-next"),
  upNextThumb: $("up-next-thumb"),
  upNextTitle: $("up-next-title"),
  upNextSub: $("up-next-sub"),
  upNextPlay: $("up-next-play"),
  heroForm: $("hero-form"),
  heroInput: $("hero-input"),
  heroPlay: $("hero-play"),
  sideForm: $("side-form"),
  sideInput: $("side-input"),
  sideLoad: $("side-load"),
  toasts: $("toasts"),
  shortcutsModal: $("shortcuts-modal"),
  confirmModal: $("confirm-modal"),
  confirmTitle: $("confirm-title"),
  confirmMessage: $("confirm-message"),
  confirmCancel: $("confirm-cancel"),
  confirmOk: $("confirm-ok"),
};

const state = {
  settings: null,
  queue: [],
  history: [],
  video: null,
  meta: null,
  player: null,
  ready: false,
  priming: false,
  prime: null,
  primeToken: 0,
  primeOnReady: true,
  pendingAutoplay: false,
  stageError: null,
  snapshot: emptySnapshot(),
  view: "player",
  stalls: 0,
  lagStreak: 0,
  lagCooldownUntil: 0,
  lastLagSample: null,
  scrubbing: false,
  scrubTime: 0,
  qualityMenuOpen: false,
  volumeDragging: false,
  confirmResolver: null,
  pendingMeta: new Set(),
  h264Dirty: false,
  loadedH264: null,
  lastVideoDataKey: "",
  startAt: 0,
  renderQueued: false,
  wantsPlay: false,
};

const persistVolume = debounce(async () => {
  if (!state.settings) return;
  state.settings = await saveSettings({
    volume: state.settings.volume,
    muted: state.settings.muted,
  });
}, 350);

init().catch((error) => {
  console.error("[LagFree player]", error);
  toast("LagFree hit an unexpected error. Try reloading the player.", "bad");
});

/* ================================================================== */
/* Boot                                                               */
/* ================================================================== */

async function init() {
  paintIcons();
  const version = safeVersion();
  el.sideVersion.textContent = `LagFree v${version}`;
  el.aboutVersion.textContent = `v${version}`;

  try {
    const [settings, lib] = await Promise.all([getSettings(), loadHistoryAndQueue()]);
    state.settings = settings;
    state.history = lib.history;
    state.queue = lib.queue;
  } catch {
    state.settings = normalizeSettings({});
    state.history = [];
    state.queue = [];
  }

  applyReduceMotion();
  syncSettingsUI();
  updateChips();
  updateCounts();
  updateQueueCount();
  updateActionButtons();
  updateVideoUI();
  updateVolumeUI(state.settings.volume, state.settings.muted);
  updateClock();
  renderQueue();
  renderHistory();
  updateUpNext();
  bindEvents();
  bindSettingsInputs();
  bindStorageSync();
  switchView(getInitialView(), { updateUrl: false });
  scheduleRender();

  const params = new URLSearchParams(location.search);
  const parsed = parseVideo(params.get("video") || "");
  if (parsed) {
    const start = params.get("t") ? Math.max(0, Number(params.get("t")) || 0) : parsed.start || 0;
    const hasMeta = params.get("title") || params.get("author");
    const meta = hasMeta
      ? { title: params.get("title") || "", author: params.get("author") || "" }
      : null;
    const initialView = getInitialView();
    await loadVideo(
      { id: parsed.id, start },
      meta,
      {
        prime: initialView === "player",
        addHistory: true,
        autoplay: false,
        keepView: initialView !== "player",
      }
    );
  } else {
    showEmpty();
  }

  setInterval(updateClock, 1000);
  setInterval(sampleLag, 1000);
  document.addEventListener("visibilitychange", () => {
    state.lastLagSample = null;
    if (!document.hidden) scheduleRender();
  });
  window.addEventListener("beforeunload", () => {
    if (state.player) state.player.destroy();
  });
  try {
    chrome.runtime?.onMessage?.addListener((message) => {
      if (message?.type === "switch-view" && VIEWS.has(message.view)) switchView(message.view);
    });
  } catch {
    /* not running as an extension page */
  }
}

function safeVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "1.0.0";
  }
}

function getInitialView() {
  const view = new URLSearchParams(location.search).get("view");
  return VIEWS.has(view) ? view : "player";
}

function emptySnapshot() {
  return {
    ready: false,
    currentTime: 0,
    duration: 0,
    loadedFraction: 0,
    bufferedSeconds: 0,
    playerState: 5,
    playing: false,
    buffering: false,
    ended: false,
    playbackQuality: "unknown",
    availableQualityLevels: [],
    volume: 100,
    muted: false,
    playbackRate: 1,
    videoData: null,
    error: null,
  };
}

/* ================================================================== */
/* Loading                                                            */
/* ================================================================== */

async function loadVideo(video, meta = null, options = {}) {
  if (!video || !video.id) return;
  const id = video.id;
  const start = Math.max(0, Number(video.start) || 0);
  const opts = {
    prime: true,
    addHistory: true,
    autoplay: false,
    force: false,
    keepView: false,
    ...options,
  };

  if (state.player && state.video?.id === id && !opts.force) {
    switchView("player");
    if (meta) {
      state.meta = mergeMeta(state.meta, meta);
      updateVideoUI();
    }
    if (Math.abs((state.snapshot.currentTime || 0) - start) > 1.5) {
      state.player.seekTo(start, true);
    }
    if (opts.autoplay) attemptPlay();
    return;
  }

  destroyPlayer();
  state.video = { id, start };
  state.startAt = start;
  state.meta = meta && (meta.title || meta.author) ? mergeMeta(null, meta) : null;
  state.ready = false;
  state.priming = false;
  state.stageError = null;
  state.snapshot = { ...emptySnapshot(), currentTime: start };
  state.stalls = 0;
  state.lagStreak = 0;
  state.lastLagSample = null;
  state.lastVideoDataKey = "";
  state.h264Dirty = false;
  state.wantsPlay = false;
  state.primeOnReady = Boolean(opts.prime);
  state.pendingAutoplay = Boolean(opts.autoplay || state.settings.autoPlayAfterBuffer);

  if (!opts.keepView && (state.view === "queue" || state.view === "history")) switchView("player", { updateUrl: false });
  syncUrl();

  el.stage.classList.add("has-video", "is-priming");
  el.stage.classList.remove("is-playing", "has-error", "is-buffering", "controls-idle");
  el.underStage.hidden = false;
  el.emptyStage.hidden = true;
  el.stageError.hidden = true;
  el.centerPlay.hidden = true;
  el.buffering.hidden = true;
  el.primeOverlay.hidden = false;
  el.primeSkip.hidden = true;
  el.primeEyebrow.textContent = "LAGFREE EMBED";
  el.primeTitle.textContent = "Connecting to YouTube…";
  el.primeSub.textContent = "Spinning up the lightweight player. No watch page, no feed, no comments.";
  el.primeFill.style.width = "0%";
  el.primeElapsed.textContent = "Connecting…";
  el.primeAhead.textContent = "";

  updateVideoUI();
  updateActionButtons();
  updateCounts();
  updateUpNext();
  setTopStatus("busy", "Connecting");
  setEngine("busy", "Connecting");
  setStatusLine("Loading video…", "yellow");

  if (opts.addHistory) addHistoryEntry(id, start, state.meta);
  updateHistoryEntryMeta(id, state.meta);
  updateQueueEntryMeta(id, state.meta);

  if (!state.meta?.title || !state.meta?.author) {
    fetchVideoMeta(id).then((fetched) => {
      if (!fetched || !state.video || state.video.id !== id) return;
      state.meta = mergeMeta(fetched, state.meta);
      updateVideoUI();
      updateHistoryEntryMeta(id, state.meta);
      updateQueueEntryMeta(id, state.meta);
      updateUpNext();
      if (state.view === "history") renderHistory();
      if (state.view === "queue") renderQueue();
    });
  }

  state.loadedH264 = Boolean(state.settings.forceH264);
  const bridge = new YTPlayer(el.iframeLayer, {
    videoId: id,
    start,
    h264: state.loadedH264,
    quality: state.settings.quality === "auto" ? "auto" : qualityToApi(state.settings.quality),
    title: state.meta?.title || "YouTube video",
  });
  state.player = bridge;
  bindBridge(bridge);

  if (!opts.prime) state.primeOnReady = false;
}

function bindBridge(bridge) {
  const guard = (fn) => (event) => {
    if (state.player !== bridge) return;
    fn(event.detail);
  };
  bridge.addEventListener("ready", guard(handleReady));
  bridge.addEventListener("info", guard(handleInfo));
  bridge.addEventListener("statechange", guard(handleState));
  bridge.addEventListener("qualitychange", guard(handleQualityChange));
  bridge.addEventListener("volumechange", guard(handleVolumeChange));
  bridge.addEventListener("error", guard(handlePlaybackError));
  bridge.addEventListener("timeout", guard(handleTimeout));
  bridge.addEventListener("playblocked", guard(handlePlayBlocked));
}

function destroyPlayer() {
  state.primeToken += 1;
  if (state.prime?.timer) clearInterval(state.prime.timer);
  state.prime = null;
  state.priming = false;
  if (state.player) {
    try {
      state.player.destroy();
    } catch {
      /* ignore */
    }
    state.player = null;
  }
  state.ready = false;
  el.iframeLayer.replaceChildren();
}

function handleReady() {
  if (!state.player || !state.video) return;
  const player = state.player;
  state.ready = true;
  hideError();
  el.primeOverlay.hidden = false;
  state.snapshot = player.getSnapshot();
  player.setVolume(state.settings.volume);
  if (state.settings.startMuted || state.settings.muted) player.mute();
  else player.unMute();
  if (state.settings.quality !== "auto") {
    player.setPlaybackQuality(qualityToApi(state.settings.quality));
  }
  updateActionButtons();
  updateVideoUI();
  scheduleRender();

  const autoplay = state.pendingAutoplay;
  state.pendingAutoplay = false;
  if (state.primeOnReady && state.settings.prebufferSeconds > 0) {
    startPriming({ autoplay });
  } else {
    finishReady({ autoplay, completed: false });
  }
}

function finishReady({ autoplay = false, completed = false } = {}) {
  if (!state.player) return;
  state.priming = false;
  if (state.prime?.timer) clearInterval(state.prime.timer);
  state.prime = null;
  state.primeToken += 1;
  state.wantsPlay = false;
  el.stage.classList.remove("is-priming");
  el.primeOverlay.hidden = true;
  el.stageError.hidden = true;
  showCenterPlay(completed ? "Play buffered video" : "Play video");
  setEngine("ready", completed ? "Primed" : "Ready");
  setTopStatus("ok", completed ? "Ready" : "Tap play");
  setStatusLine(completed ? "Buffered and ready" : "Ready to play", completed ? "green" : "yellow");
  updateActionButtons();
  scheduleRender();
  if (autoplay || state.settings.autoPlayAfterBuffer) {
    attemptPlay();
  }
}

/* ================================================================== */
/* Pre-buffer                                                         */
/* ================================================================== */

async function startPriming({ manual = false, autoplay = false } = {}) {
  if (!state.player || !state.ready || state.priming || state.stageError) return;
  const player = state.player;
  const target = manual ? state.settings.prebufferSeconds || 5 : state.settings.prebufferSeconds;
  if (target <= 0) {
    finishReady({ autoplay });
    return;
  }

  const snapshot = player.getSnapshot();
  const prime = {
    token: ++state.primeToken,
    manual,
    target,
    resume: manual ? snapshot.currentTime : state.startAt || 0,
    wasPlaying: snapshot.playing,
    priorMuted: snapshot.muted,
    startedAt: performance.now(),
    timer: null,
  };
  state.prime = prime;
  state.priming = true;
  el.stage.classList.add("is-priming");
  el.stage.classList.remove("is-playing");
  el.primeOverlay.hidden = false;
  el.stageError.hidden = true;
  el.centerPlay.hidden = true;
  el.primeEyebrow.textContent = "BUFFER ENGINE";
  el.primeTitle.textContent = manual ? "Topping up the buffer…" : "Building a buffer…";
  el.primeSub.textContent = "Playing the opening seconds muted so your first click starts smooth. The rest streams normally.";
  el.primeFill.style.width = "0%";
  el.primeElapsed.textContent = `0.0s / ${target}s`;
  el.primeAhead.textContent = `${Math.round(snapshot.bufferedSeconds)}s ahead`;
  el.primeSkip.hidden = false;
  setEngine("busy", "Priming");
  setTopStatus("busy", "Priming");
  setStatusLine("Pre-buffering…", "yellow");
  updateActionButtons();

  player.mute();
  player.setVolume(state.settings.volume);
  if (manual) player.seekTo(prime.resume, true);
  await sleep(120);
  if (!primeIsCurrent(prime)) return;
  player.play();

  prime.timer = setInterval(() => updatePrimeUI(prime), 120);
  const started = performance.now();
  await waitFor(
    () => {
      if (!primeIsCurrent(prime)) return true;
      const snap = player.getSnapshot();
      if (snap.ended) return true;
      if (snap.currentTime - prime.resume >= target - 0.05) return true;
      if (performance.now() - started > 3800 && snap.currentTime < prime.resume + 0.2) return true;
      return false;
    },
    { timeout: 14000 + target * 1000, interval: 120 }
  );

  if (!primeIsCurrent(prime)) return;
  const snap = player.getSnapshot();
  const completed = snap.ended || snap.currentTime - prime.resume >= target - 0.3;
  finishPriming(prime, { completed, autoplay });
}

function primeIsCurrent(prime) {
  return state.prime === prime && state.player && !state.player.destroyed && !state.player.error;
}

function updatePrimeUI(prime) {
  if (!primeIsCurrent(prime)) return;
  const snap = state.player.getSnapshot();
  const elapsed = Math.max(0, snap.currentTime - prime.resume);
  const pct = clamp((elapsed / prime.target) * 100, 0, 100);
  el.primeFill.style.width = `${pct.toFixed(1)}%`;
  el.primeElapsed.textContent = `${Math.min(elapsed, prime.target).toFixed(1)}s / ${prime.target}s`;
  el.primeAhead.textContent = `${Math.round(snap.bufferedSeconds)}s ahead`;
  state.snapshot = snap;
  scheduleRender();
}

function finishPriming(prime, { completed = false, autoplay = false } = {}) {
  if (state.prime !== prime) return;
  state.primeToken += 1;
  if (prime.timer) clearInterval(prime.timer);
  const player = state.player;
  state.prime = null;
  state.priming = false;
  state.wantsPlay = false;
  el.stage.classList.remove("is-priming");
  el.primeOverlay.hidden = true;
  if (player) {
    player.pause();
    player.seekTo(prime.resume, true);
    player.setVolume(state.settings.volume);
    if (state.settings.startMuted || state.settings.muted || prime.priorMuted) player.mute();
    else player.unMute();
  }
  showCenterPlay(completed ? (prime.resume > 0 ? "Resume buffered video" : "Play buffered video") : "Play video");
  setEngine(completed ? "ready" : "idle", completed ? "Primed" : "Ready");
  setTopStatus(completed ? "ok" : "busy", completed ? "Ready" : "Tap play");
  setStatusLine(completed ? `Buffered ${Math.round(state.snapshot.bufferedSeconds)}s ahead` : "Ready to play", completed ? "green" : "yellow");
  updateActionButtons();
  scheduleRender();
  if (completed && (autoplay || prime.wasPlaying || state.settings.autoPlayAfterBuffer)) {
    attemptPlay();
  }
}

function cancelPriming() {
  if (!state.priming || !state.prime) return;
  const prime = state.prime;
  state.primeToken += 1;
  if (prime.timer) clearInterval(prime.timer);
  state.prime = null;
  state.priming = false;
  state.wantsPlay = false;
  const player = state.player;
  if (player) {
    player.pause();
    player.seekTo(prime.resume, true);
    if (state.settings.startMuted || state.settings.muted) player.mute();
    else player.unMute();
  }
  el.stage.classList.remove("is-priming");
  el.primeOverlay.hidden = true;
  showCenterPlay("Play video");
  setEngine("ready", "Ready");
  setTopStatus("ok", "Paused");
  setStatusLine("Ready to play", "yellow");
  updateActionButtons();
  scheduleRender();
}

/* ================================================================== */
/* Player events                                                      */
/* ================================================================== */

function handleInfo(snapshot) {
  if (!state.player) return;
  state.snapshot = snapshot;
  if (snapshot.videoData) applyVideoData(snapshot.videoData);
  scheduleRender();
}

function handleState() {
  if (!state.player) return;
  state.snapshot = state.player.getSnapshot();
  if (state.snapshot.playing) {
    state.pendingAutoplay = false;
  } else if (state.snapshot.ended || state.snapshot.playerState === 2 || state.snapshot.playerState === 5) {
    state.wantsPlay = false;
  }
  scheduleRender();
}

function handleQualityChange() {
  updateQualityMenu();
  scheduleRender();
}

function handleVolumeChange(detail) {
  if (!detail) return;
  state.snapshot.volume = detail.volume;
  state.snapshot.muted = detail.muted;
  if (!state.volumeDragging) updateVolumeUI(detail.volume, detail.muted);
}

function hideError() {
  state.stageError = null;
  el.stageError.hidden = true;
  el.stage.classList.remove("has-error");
}

function handlePlaybackError(detail) {
  if (!detail) return;
  state.primeToken += 1;
  if (state.prime?.timer) clearInterval(state.prime.timer);
  state.prime = null;
  state.priming = false;
  state.pendingAutoplay = false;
  state.wantsPlay = false;
  state.stageError = detail;
  el.primeOverlay.hidden = true;
  el.centerPlay.hidden = true;
  el.buffering.hidden = true;
  el.stage.classList.remove("is-priming", "is-playing", "is-buffering");
  el.stage.classList.add("has-error");
  el.stageError.hidden = false;
  el.errorTitle.textContent = "This video can’t play here";
  let message = detail.message || "YouTube refused to play this video in an embed.";
  if (state.settings.forceH264 && detail.code === 5) {
    message += " H.264 boost can trigger this on a few videos — turn it off in Settings and retry.";
  }
  message += " You can always open it on YouTube.";
  el.errorMessage.textContent = message;
  if (!state.meta?.title) {
    el.nowTitle.textContent = "Video unavailable";
    el.miniTitle.textContent = "Video unavailable";
    el.miniSub.textContent = state.video?.id || "YouTube";
    document.title = "Video unavailable · LagFree";
  }
  el.stageStatePill.textContent = "ERROR";
  setEngine("error", "Error");
  setTopStatus("error", "Error");
  setStatusLine("Playback error", "red");
  updateActionButtons();
  scheduleRender();
}

function handleTimeout() {
  if (state.ready || !state.video) return;
  state.wantsPlay = false;
  state.stageError = { code: "timeout", message: "The embedded player is taking longer than usual." };
  el.primeOverlay.hidden = true;
  el.stage.classList.remove("is-priming");
  el.stage.classList.add("has-error");
  el.stageError.hidden = false;
  el.centerPlay.hidden = true;
  el.errorTitle.textContent = "Still connecting…";
  el.errorMessage.textContent =
    "YouTube’s embed is taking longer than usual. Retry, or open the video on YouTube and keep the lag-free player for the next one.";
  el.stageStatePill.textContent = "TIMEOUT";
  setEngine("error", "Timeout");
  setTopStatus("busy", "Slow");
  setStatusLine("Embed timed out", "yellow");
  updateActionButtons();
}

function handlePlayBlocked() {
  if (!state.player || state.priming) return;
  state.pendingAutoplay = false;
  state.wantsPlay = false;
  try {
    state.player.pause();
  } catch {
    /* ignore */
  }
  showCenterPlay("Play video");
  toast("Autoplay was blocked. Press play to start.", "busy");
  setTopStatus("busy", "Tap play");
  updateActionButtons();
  scheduleRender();
}

function applyVideoData(data) {
  if (!data) return;
  const title = String(data.title || "").trim();
  const author = String(data.author || "").trim();
  if (!title && !author) return;
  const key = `${title}|${author}`;
  if (key === state.lastVideoDataKey) return;
  state.lastVideoDataKey = key;
  const next = mergeMeta(null, state.meta);
  if (!next.title && title) next.title = title;
  if (!next.author && author) next.author = author;
  state.meta = next;
  updateVideoUI();
  if (state.video) {
    updateHistoryEntryMeta(state.video.id, next);
    updateQueueEntryMeta(state.video.id, next);
    updateUpNext();
    if (state.view === "history") renderHistory();
    if (state.view === "queue") renderQueue();
  }
}

/* ================================================================== */
/* Rendering                                                          */
/* ================================================================== */

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    render();
  });
}

function render() {
  const snapshot = state.snapshot;
  const hasVideo = Boolean(state.video);
  const duration = snapshot.duration || 0;
  const current = state.scrubbing ? state.scrubTime : clamp(snapshot.currentTime || 0, 0, duration || Infinity);
  const ratio = duration > 0 ? clamp(current / duration, 0, 1) : 0;
  const forceHours = duration >= 3600;
  const quality = snapshot.playbackQuality && snapshot.playbackQuality !== "unknown"
    ? friendlyQuality(snapshot.playbackQuality)
    : qualityLabel(state.settings.quality);
  const ahead = Math.max(0, snapshot.bufferedSeconds || 0);

  el.seekPlayed.style.width = `${(ratio * 100).toFixed(2)}%`;
  el.seekBuffer.style.width = `${((snapshot.loadedFraction || 0) * 100).toFixed(2)}%`;
  el.seekThumb.style.left = `${(ratio * 100).toFixed(2)}%`;
  el.timeCurrent.textContent = formatTime(current, { forceHours });
  el.timeDuration.textContent = formatTime(duration, { forceHours });
  el.seek.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  el.seek.setAttribute("aria-valuetext", `${formatTime(current, { forceHours })} of ${formatTime(duration, { forceHours })}`);

  el.stage.classList.toggle("has-video", hasVideo);
  el.stage.classList.toggle("is-playing", Boolean(snapshot.playing && !state.priming && !state.stageError));
  el.stage.classList.toggle("is-buffering", Boolean(snapshot.buffering && state.ready && !state.priming && state.wantsPlay));
  el.stage.classList.toggle("has-error", Boolean(state.stageError));

  const centerVisible =
    Boolean(hasVideo && state.ready && !state.priming && !state.stageError && !snapshot.playing && !state.wantsPlay);
  el.centerPlay.hidden = !centerVisible;
  el.buffering.hidden = !(state.ready && snapshot.buffering && !state.priming && !state.stageError && !centerVisible);
  setIcon(el.playIcon, snapshot.playing || snapshot.buffering ? "pause" : "play");
  el.btnPlay.setAttribute("aria-label", snapshot.playing || snapshot.buffering ? "Pause" : "Play");

  let stageState = "IDLE";
  if (state.stageError) stageState = "ERROR";
  else if (state.priming) stageState = "PRIMING";
  else if (!hasVideo) stageState = "IDLE";
  else if (!state.ready) stageState = "LOADING";
  else if (snapshot.ended) stageState = "ENDED";
  else if (snapshot.playing) stageState = "PLAYING";
  else if (snapshot.buffering && state.wantsPlay) stageState = "BUFFERING";
  else stageState = "PAUSED";
  el.stageStatePill.textContent = stageState;
  el.stageQuality.textContent = quality;
  el.stageCodec.textContent = state.h264Dirty ? "RELOAD" : state.settings.forceH264 ? "H.264" : "AUTO";
  el.stageCodec.classList.toggle("muted", !state.settings.forceH264);

  el.qualityLabelEl.textContent = quality;
  el.inspQuality.textContent = quality;
  el.statusQuality.textContent = quality;
  el.inspLoaded.textContent = `${Math.round((snapshot.loadedFraction || 0) * 100)}%`;
  el.inspStalls.textContent = String(state.stalls);
  el.inspCodec.textContent = state.settings.forceH264 ? "H.264" : "Auto";
  el.engineAhead.textContent = String(Math.round(ahead));
  el.engineMeter.style.width = `${clamp((ahead / BUFFER_TARGET) * 100, 0, 100).toFixed(1)}%`;
  el.bufferChipText.textContent = `Buffered ${formatTime(ahead)}`;
  el.statusBuffer.textContent = hasVideo ? `Buffer ${formatTime(ahead)}` : "Buffer —";

  const bufferTone = !hasVideo ? "" : ahead > 10 ? "green" : ahead > 3 ? "yellow" : "red";
  setDotClass(el.bufferChip.querySelector(".dot"), bufferTone);
  el.mini.classList.toggle("playing", Boolean(snapshot.playing && !state.priming));

  if (!state.volumeDragging) {
    updateVolumeUI(snapshot.volume ?? state.settings.volume, snapshot.muted ?? state.settings.muted);
  }

  updateEngineForState();
  updateTopForState();
  updateStatusLine(quality);
  updateCenterLabel(snapshot);
  updateActionButtons();

  if (snapshot.videoData) applyVideoData(snapshot.videoData);
}

function updateEngineForState() {
  if (!state.video) return setEngine("idle", "Idle");
  if (state.stageError) return setEngine("error", "Error");
  if (state.priming) return setEngine("busy", "Priming");
  if (!state.ready) return setEngine("busy", "Connecting");
  if (state.snapshot.playing) return setEngine("ready", "Playing");
  if (state.snapshot.buffering && state.wantsPlay) return setEngine("busy", "Buffering");
  if (state.snapshot.ended) return setEngine("ready", "Ended");
  return setEngine("ready", "Ready");
}

function updateTopForState() {
  if (!state.video) return setTopStatus("idle", "Idle");
  if (state.stageError) return setTopStatus("error", "Error");
  if (state.priming) return setTopStatus("busy", "Priming");
  if (!state.ready) return setTopStatus("busy", "Connecting");
  if (state.snapshot.playing) return setTopStatus("ok", "Playing");
  if (state.snapshot.buffering && state.wantsPlay) return setTopStatus("busy", "Buffering");
  if (state.snapshot.ended) return setTopStatus("ok", "Ended");
  return setTopStatus("ok", "Paused");
}

function updateStatusLine(quality) {
  const snapshot = state.snapshot;
  let text = "No video loaded";
  let tone = "";
  if (state.video) {
    if (state.stageError) {
      text = "Playback error";
      tone = "red";
    } else if (state.priming) {
      text = "Pre-buffering the opening seconds…";
      tone = "yellow";
    } else if (!state.ready) {
      text = "Connecting to YouTube…";
      tone = "yellow";
    } else if (snapshot.buffering && state.wantsPlay) {
      text = "Buffering…";
      tone = "yellow";
    } else if (snapshot.playing) {
      text = `Playing · ${quality}`;
      tone = "green";
    } else if (snapshot.ended) {
      text = "Ended";
      tone = "";
    } else {
      text = `Paused · ${quality}`;
      tone = "green";
    }
  }
  el.statusLine.textContent = text;
  setDotClass(el.statusDot, tone);
}

function updateCenterLabel(snapshot) {
  if (snapshot.ended) el.centerLabel.textContent = "Replay video";
  else if (snapshot.currentTime > 0.5) el.centerLabel.textContent = "Resume video";
  else if ((snapshot.bufferedSeconds || 0) > 2) el.centerLabel.textContent = "Play buffered video";
  else el.centerLabel.textContent = "Play video";
}

function setTopStatus(kind, text) {
  const classes = { ok: "ok", busy: "busy", error: "error", idle: "" };
  el.topStatus.className = `top-status ${classes[kind] || ""}`.trim();
  el.topStatusText.textContent = text;
}

function setEngine(kind, text) {
  el.engineStatus.className = `engine-pill ${kind || ""}`.trim();
  el.engineStatusText.textContent = text;
}

function setStatusLine(text, tone = "") {
  el.statusLine.textContent = text;
  setDotClass(el.statusDot, tone);
}

function setDotClass(dot, tone) {
  if (!dot) return;
  dot.className = "dot" + (tone ? ` ${tone}` : "");
}

function showCenterPlay(label) {
  el.centerLabel.textContent = label || "Play video";
  el.centerPlay.hidden = false;
}

/* ================================================================== */
/* Video metadata UI                                                  */
/* ================================================================== */

function mergeMeta(a, b) {
  const out = { ...(a || {}) };
  for (const [key, value] of Object.entries(b || {})) {
    if (value !== undefined && value !== null && String(value).trim() !== "") out[key] = value;
  }
  return out;
}

function updateVideoUI() {
  const video = state.video;
  const meta = state.meta || {};
  const title = meta.title || (video ? "Loading video…" : "Nothing playing yet");
  const author = meta.author || (video ? "YouTube" : "Paste a YouTube link to begin");
  const id = video?.id || "—";
  const thumb = meta.thumbnail || (video ? thumbnailUrl(video.id, "mqdefault") : "");

  el.nowTitle.textContent = title;
  el.nowAuthor.textContent = author;
  el.nowId.textContent = id;
  el.nowEyebrow.textContent = "NOW PLAYING";
  el.miniTitle.textContent = title;
  el.miniSub.textContent = video ? author : "Paste a link to start";
  const miniContainer = el.miniThumb.closest(".mini-thumb");
  if (thumb) {
    el.miniThumb.src = thumb;
    miniContainer?.classList.remove("empty");
  } else {
    el.miniThumb.removeAttribute("src");
    miniContainer?.classList.add("empty");
  }
  el.miniThumb.alt = "";
  el.miniThumb.onerror = () => {
    miniContainer?.classList.add("empty");
  };
  document.title = video ? `${title} · LagFree` : "LagFree — Smooth YouTube Player";
  updateActionButtons();
  updateChips();
  updateQualityMenu();
}

function updateActionButtons() {
  const hasVideo = Boolean(state.video);
  const ready = state.ready;
  for (const button of [el.btnQueue, el.btnCopy, el.btnOpenYt, el.btnOpenYt2, el.btnReload, el.btnReload2]) {
    button.disabled = !hasVideo;
  }
  el.btnPlay.disabled = !hasVideo || !ready || Boolean(state.stageError);
  el.btnQuality.disabled = !hasVideo;
  el.btnMute.disabled = !hasVideo;
  el.btnFullscreen.disabled = !hasVideo;
  el.sidePrime.disabled = !hasVideo || !ready || state.priming || Boolean(state.stageError);
  el.btnPrime.disabled = !hasVideo || !ready || state.priming || Boolean(state.stageError);
  el.seek.setAttribute("aria-disabled", String(!hasVideo || !ready));
  el.volume.setAttribute("aria-disabled", String(!hasVideo || !ready));
}

function updateQualityMenu() {
  el.qualityMenu.querySelectorAll("[data-quality]").forEach((item) => {
    item.classList.toggle("selected", item.dataset.quality === state.settings.quality);
  });
}

function updateChips() {
  const settings = state.settings;
  if (!settings) return;
  el.chipQuality.querySelector("span:last-child").textContent = `Cap ${qualityLabel(settings.quality)}`;
  el.chipCodec.querySelector("span:last-child").textContent = state.h264Dirty
    ? "H.264 · reload"
    : settings.forceH264
      ? "H.264 boost"
      : "Auto codec";
  el.chipCodec.classList.toggle("hot", settings.forceH264 && !state.h264Dirty);
  el.chipCodec.classList.toggle("off", !settings.forceH264);
  const seconds = Number(settings.prebufferSeconds) || 0;
  el.chipBuffer.querySelector("span:last-child").textContent = seconds > 0 ? `Pre-buffer ${seconds}s` : "Pre-buffer off";
  el.chipBuffer.classList.toggle("hot", seconds > 0);
  el.chipBuffer.classList.toggle("off", seconds === 0);
  const guard = settings.lagGuard;
  el.chipGuard.querySelector("span:last-child").textContent =
    guard === "off" ? "Lag guard off" : `Lag guard ${guard}`;
  el.chipGuard.classList.toggle("off", guard === "off");
}

/* ================================================================== */
/* Playback actions                                                   */
/* ================================================================== */

function togglePlay() {
  if (!state.video) return;
  if (!state.player || !state.ready) {
    toast("The player is still connecting…", "busy");
    return;
  }
  if (state.priming) return;
  const snapshot = state.player.getSnapshot();
  if (snapshot.playing || snapshot.buffering) {
    state.wantsPlay = false;
    state.player.pause();
    scheduleRender();
    return;
  }
  attemptPlay();
}

function attemptPlay() {
  if (!state.player || !state.ready || state.priming || state.stageError) return;
  const player = state.player;
  const snapshot = player.getSnapshot();
  if (snapshot.ended || (snapshot.duration > 0 && snapshot.currentTime >= snapshot.duration - 0.3)) {
    player.seekTo(0, true);
  }
  player.setVolume(state.settings.volume);
  if (state.settings.startMuted || state.settings.muted) player.mute();
  else player.unMute();
  state.wantsPlay = true;
  player.play();
  state.pendingAutoplay = false;
  el.centerPlay.hidden = true;
  setTopStatus("busy", "Starting");
  scheduleRender();
}

function seekTo(seconds) {
  if (!state.player || !state.ready) return;
  const duration = state.snapshot.duration || 0;
  const target = clamp(Number(seconds) || 0, 0, duration || Infinity);
  state.player.seekTo(target, true);
  state.snapshot.currentTime = target;
  if (state.scrubbing) {
    state.scrubbing = false;
    el.seek.classList.remove("scrubbing");
  }
  scheduleRender();
}

function changeVolume(value, { persist = true, unmute = false } = {}) {
  const next = Math.round(clamp(Number(value) || 0, 0, 100));
  state.settings.volume = next;
  if (state.player) {
    state.player.setVolume(next);
    if (unmute && next > 0) {
      state.settings.muted = false;
      state.player.unMute();
    }
  }
  updateVolumeUI(next, state.settings.muted);
  if (persist) persistVolume();
}

function toggleMute() {
  if (!state.player) return;
  const snapshot = state.player.getSnapshot();
  const shouldUnmute = snapshot.muted || state.settings.volume === 0;
  if (shouldUnmute) {
    if (state.settings.volume === 0) changeVolume(50, { persist: false });
    state.settings.muted = false;
    state.player.unMute();
  } else {
    state.settings.muted = true;
    state.player.mute();
  }
  updateVolumeUI(state.settings.volume, state.settings.muted);
  saveSettings({ muted: state.settings.muted, volume: state.settings.volume }).then((settings) => {
    state.settings = settings;
  });
  scheduleRender();
}

function updateVolumeUI(volume, muted) {
  const value = clamp(Number(volume) || 0, 0, 100);
  el.volumeFill.style.width = `${value}%`;
  el.volumeThumb.style.left = `${value}%`;
  el.volume.setAttribute("aria-valuenow", String(Math.round(value)));
  el.volume.setAttribute("aria-valuetext", `${Math.round(value)}%`);
  const icon = muted || value === 0 ? "mute" : value < 50 ? "volume-low" : "volume";
  setIcon(el.volumeIcon, icon);
  el.btnMute.setAttribute("aria-label", muted || value === 0 ? "Unmute" : "Mute");
}

function changeQuality(value) {
  if (!state.settings) return;
  state.settings = { ...state.settings, quality: value };
  if (state.player?.ready) state.player.setPlaybackQuality(qualityToApi(value));
  syncSettingsUI();
  updateChips();
  updateQualityMenu();
  saveSettings({ quality: value }).then((settings) => {
    state.settings = settings;
  });
  toast(`Quality cap set to ${qualityLabel(value)}`, "good");
  scheduleRender();
}

async function toggleFullscreen() {
  if (!state.video) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el.stage.requestFullscreen();
  } catch {
    toast("Fullscreen was blocked by the browser.", "bad");
  }
}

function reloadVideo({ keepTime = true } = {}) {
  if (!state.video) return;
  const time = keepTime && state.player ? state.player.getSnapshot().currentTime || state.startAt : state.startAt;
  const wasPlaying = Boolean(state.snapshot.playing || state.wantsPlay);
  const meta = state.meta;
  loadVideo(
    { id: state.video.id, start: time },
    meta,
    { prime: false, addHistory: false, autoplay: wasPlaying, force: true }
  );
  state.h264Dirty = false;
  updateChips();
}

/* ================================================================== */
/* Settings                                                           */
/* ================================================================== */

function bindSettingsInputs() {
  document.querySelectorAll("[data-setting]").forEach((input) => {
    input.addEventListener("input", () => {
      if (input.dataset.setting === "prebufferSeconds") {
        const value = Number(input.value);
        document.querySelectorAll('[data-label-for="prebufferSeconds"]').forEach((node) => {
          node.textContent = `${value}s`;
        });
        if (state.settings) state.settings.prebufferSeconds = value;
        updateChips();
      }
    });
    input.addEventListener("change", () => {
      const key = input.dataset.setting;
      let value;
      if (input.type === "checkbox") value = input.checked;
      else if (input.type === "range") value = Number(input.value);
      else value = input.value;
      applySetting(key, value);
    });
  });
}

async function applySetting(key, value) {
  state.settings = await saveSettings({ [key]: value });
  if (key === "reduceMotion") applyReduceMotion();
  if (key === "forceH264" && state.video) {
    state.h264Dirty = state.loadedH264 !== null && Boolean(value) !== state.loadedH264;
    if (state.h264Dirty) toast("H.264 boost changed — press R or Reload to apply.", "busy");
  }
  if (key === "quality" && state.player?.ready) {
    state.player.setPlaybackQuality(qualityToApi(value));
  }
  if (key === "lagGuard" && value === "off") {
    state.lagStreak = 0;
  }
  syncSettingsUI();
  updateChips();
  updateQualityMenu();
  scheduleRender();
}

function syncSettingsUI() {
  if (!state.settings) return;
  document.querySelectorAll("[data-setting]").forEach((input) => {
    const key = input.dataset.setting;
    if (!(key in state.settings)) return;
    const value = state.settings[key];
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = String(value);
  });
  document.querySelectorAll("[data-label-for]").forEach((node) => {
    const key = node.dataset.labelFor;
    if (key === "prebufferSeconds") node.textContent = `${state.settings.prebufferSeconds}s`;
  });
  updateQualityMenu();
  updateChips();
}

function applyReduceMotion() {
  document.documentElement.classList.toggle("reduce-motion", Boolean(state.settings?.reduceMotion));
}

/* ================================================================== */
/* Lag guard                                                          */
/* ================================================================== */

function sampleLag() {
  if (!state.player || !state.ready || state.priming || state.stageError) {
    state.lastLagSample = null;
    return;
  }
  if (document.hidden || state.settings.lagGuard === "off") {
    state.lastLagSample = null;
    return;
  }
  const snapshot = state.player.getSnapshot();
  if (!snapshot.playing || snapshot.buffering || snapshot.ended) {
    state.lastLagSample = null;
    return;
  }
  const now = performance.now();
  const sample = { time: snapshot.currentTime, at: now };
  const previous = state.lastLagSample;
  state.lastLagSample = sample;
  if (!previous) return;
  const delta = sample.time - previous.time;
  const wall = (now - previous.at) / 1000;
  if (delta < -0.6 || delta > Math.max(4, wall * 3)) {
    state.lagStreak = 0;
    return;
  }
  if (delta < wall * 0.45) {
    state.lagStreak += 1;
  } else {
    state.lagStreak = 0;
  }
  const threshold = state.settings.lagGuard === "aggressive" ? 1 : 2;
  if (state.lagStreak < threshold || now < state.lagCooldownUntil) return;

  state.stalls += 1;
  state.lagStreak = 0;
  state.lagCooldownUntil = now + 9000;
  el.inspStalls.textContent = String(state.stalls);
  if (state.settings.adaptiveQuality) dropQualityForLag();
  else toast("Playback is stuttering. Try 720p or H.264 boost.", "busy");
  scheduleRender();
}

function dropQualityForLag() {
  const actual = state.snapshot.playbackQuality;
  const current = state.settings.quality === "auto" && actual && actual !== "unknown" ? actual : state.settings.quality;
  const ladder = {
    highres: "hd1080",
    hd2160: "hd1080",
    hd1440: "hd1080",
    hd1080: "hd720",
    hd720: "large",
    large: "medium",
    medium: "medium",
    small: "medium",
    tiny: "medium",
    auto: "hd720",
  };
  const next = ladder[current] || "large";
  if (next === current && (current === "medium" || current === "small" || current === "tiny")) {
    toast("Lag guard is already at the lightest quality. Check other tabs and hardware acceleration.", "bad");
    return;
  }
  state.settings.quality = next;
  if (state.player?.ready) state.player.setPlaybackQuality(qualityToApi(next));
  saveSettings({ quality: next }).then((settings) => {
    state.settings = settings;
    syncSettingsUI();
    updateChips();
  });
  toast(`Lag guard: dropped to ${qualityLabel(next)} to keep playback smooth.`, "busy");
}

/* ================================================================== */
/* History & queue                                                    */
/* ================================================================== */

function addHistoryEntry(id, start, meta = null) {
  if (!state.settings?.rememberHistory) return;
  const existingIndex = state.history.findIndex((entry) => entry.id === id);
  const existing = existingIndex >= 0 ? state.history.splice(existingIndex, 1)[0] : null;
  const entry = {
    ...(existing || {}),
    id,
    title: meta?.title || existing?.title || "",
    author: meta?.author || existing?.author || "",
    thumbnail: meta?.thumbnail || existing?.thumbnail || thumbnailUrl(id, "mqdefault"),
    start: Number(start) || 0,
    lastPlayedAt: Date.now(),
  };
  state.history.unshift(entry);
  state.history = state.history.slice(0, 60);
  saveHistory(state.history);
  if (state.view === "history") renderHistory();
}

function updateHistoryEntryMeta(id, meta) {
  if (!meta || (!meta.title && !meta.author)) return;
  let changed = false;
  const entry = state.history.find((item) => item.id === id);
  if (entry) {
    if (!entry.title && meta.title) {
      entry.title = meta.title;
      changed = true;
    }
    if (!entry.author && meta.author) {
      entry.author = meta.author;
      changed = true;
    }
    if (!entry.thumbnail && meta.thumbnail) {
      entry.thumbnail = meta.thumbnail;
      changed = true;
    }
  }
  if (changed) {
    saveHistory(state.history);
    if (state.view === "history") renderHistory();
  }
}

async function addToQueue(entry, { silent = false } = {}) {
  if (!entry?.id) return;
  if (state.queue.some((item) => item.id === entry.id)) {
    if (!silent) toast("That video is already in the queue.", "busy");
    return;
  }
  state.queue.push({
    id: entry.id,
    title: entry.title || "",
    author: entry.author || "",
    thumbnail: entry.thumbnail || thumbnailUrl(entry.id, "mqdefault"),
    start: Number(entry.start) || 0,
    addedAt: Date.now(),
  });
  await saveQueue(state.queue);
  updateQueueCount();
  updateUpNext();
  if (state.view === "queue") renderQueue();
  if (!entry.title) hydrateEntryMeta(entry.id, "queue");
  if (!silent) toast("Added to the play queue.", "good");
}

async function removeQueueEntry(id) {
  state.queue = state.queue.filter((entry) => entry.id !== id);
  await saveQueue(state.queue);
  updateQueueCount();
  updateUpNext();
  renderQueue();
}

async function removeHistoryEntry(id) {
  state.history = state.history.filter((entry) => entry.id !== id);
  await saveHistory(state.history);
  renderHistory();
}

function updateQueueEntryMeta(id, meta) {
  if (!meta || (!meta.title && !meta.author)) return;
  let changed = false;
  const entry = state.queue.find((item) => item.id === id);
  if (entry) {
    if (!entry.title && meta.title) {
      entry.title = meta.title;
      changed = true;
    }
    if (!entry.author && meta.author) {
      entry.author = meta.author;
      changed = true;
    }
    if (!entry.thumbnail && meta.thumbnail) {
      entry.thumbnail = meta.thumbnail;
      changed = true;
    }
  }
  if (changed) {
    saveQueue(state.queue);
    updateUpNext();
    if (state.view === "queue") renderQueue();
  }
}

function hydrateEntryMeta(id, type) {
  const key = `${type}:${id}`;
  if (state.pendingMeta.has(key)) return;
  state.pendingMeta.add(key);
  fetchVideoMeta(id).then((meta) => {
    state.pendingMeta.delete(key);
    if (!meta) return;
    if (type === "queue") {
      const entry = state.queue.find((item) => item.id === id);
      if (!entry) return;
      entry.title = entry.title || meta.title;
      entry.author = entry.author || meta.author;
      entry.thumbnail = entry.thumbnail || meta.thumbnail;
      saveQueue(state.queue);
      updateUpNext();
      if (state.view === "queue") renderQueue();
    } else {
      const entry = state.history.find((item) => item.id === id);
      if (!entry) return;
      entry.title = entry.title || meta.title;
      entry.author = entry.author || meta.author;
      entry.thumbnail = entry.thumbnail || meta.thumbnail;
      saveHistory(state.history);
      if (state.view === "history") renderHistory();
    }
  });
}

function renderQueue() {
  const list = el.queueList;
  list.replaceChildren();
  if (!state.queue.length) {
    list.append(emptyList("queue", "Nothing queued yet", "Paste a link above, or use the Queue button under the player."));
    paintIcons(list);
    updateQueueCount();
    return;
  }
  state.queue.forEach((entry, index) => {
    if (!entry.title) hydrateEntryMeta(entry.id, "queue");
    list.append(createMediaRow(entry, { type: "queue", index: index + 1 }));
  });
  paintIcons(list);
  updateQueueCount();
}

function renderHistory() {
  const list = el.historyList;
  list.replaceChildren();
  if (!state.history.length) {
    list.append(emptyList("history", "No history yet", "Videos you play in LagFree will show up here. Stored only on this device."));
    paintIcons(list);
    updateCounts();
    return;
  }
  state.history.forEach((entry) => {
    if (!entry.title) hydrateEntryMeta(entry.id, "history");
    list.append(createMediaRow(entry, { type: "history" }));
  });
  paintIcons(list);
  updateCounts();
}

function createMediaRow(entry, { type, index }) {
  const row = document.createElement("div");
  row.className = "media-row";
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", `Play ${entry.title || "YouTube video"}`);

  if (type === "queue") {
    const number = document.createElement("span");
    number.className = "media-index";
    number.textContent = String(index).padStart(2, "0");
    row.append(number);
  }

  const thumb = document.createElement("img");
  thumb.className = "media-thumb";
  thumb.alt = "";
  thumb.loading = "lazy";
  thumb.referrerPolicy = "no-referrer";
  thumb.src = entry.thumbnail || thumbnailUrl(entry.id, "mqdefault");
  thumb.addEventListener("error", () => {
    thumb.style.visibility = "hidden";
  });

  const copy = document.createElement("div");
  copy.className = "media-copy";
  const title = document.createElement("span");
  title.className = "media-title";
  title.textContent = entry.title || "YouTube video";
  const sub = document.createElement("span");
  sub.className = "media-sub";
  if (type === "queue") {
    sub.textContent = `${entry.author || "YouTube"} · added ${entry.addedAt ? relative(entry.addedAt) : "just now"}`;
  } else {
    sub.textContent = `${entry.author || "YouTube"} · played ${entry.lastPlayedAt ? relative(entry.lastPlayedAt) : "recently"}`;
  }
  copy.append(title, sub);

  const actions = document.createElement("div");
  actions.className = "media-actions";

  const play = document.createElement("button");
  play.className = "media-play";
  play.type = "button";
  play.title = "Play now";
  play.setAttribute("aria-label", "Play now");
  play.append(iconNode("play"));
  play.addEventListener("click", (event) => {
    event.stopPropagation();
    playEntry(entry, type);
  });

  const remove = document.createElement("button");
  remove.className = "media-action danger";
  remove.type = "button";
  remove.title = type === "queue" ? "Remove from queue" : "Remove from history";
  remove.setAttribute("aria-label", remove.title);
  remove.append(iconNode("x"));
  remove.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (type === "queue") await removeQueueEntry(entry.id);
    else await removeHistoryEntry(entry.id);
  });

  actions.append(play, remove);
  if (type === "queue") {
    const moveUp = document.createElement("button");
    moveUp.className = "media-action";
    moveUp.type = "button";
    moveUp.title = "Move up";
    moveUp.setAttribute("aria-label", "Move up");
    moveUp.append(iconNode("arrow-up"));
    moveUp.disabled = index <= 1;
    moveUp.addEventListener("click", (event) => {
      event.stopPropagation();
      moveQueue(index - 1);
    });
    actions.append(moveUp);
  }

  row.append(thumb, copy, actions);
  row.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    playEntry(entry, type);
  });
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      playEntry(entry, type);
    }
  });
  return row;
}

function playEntry(entry, type) {
  if (!entry?.id) return;
  state.meta = null;
  loadVideo(
    { id: entry.id, start: Number(entry.start) || 0 },
    entry.title ? { title: entry.title, author: entry.author } : null,
    { prime: true, addHistory: true, autoplay: true }
  );
  if (type === "queue") {
    state.queue = state.queue.filter((item) => item.id !== entry.id);
    saveQueue(state.queue);
    updateQueueCount();
    updateUpNext();
  }
}

function moveQueue(index) {
  if (index <= 0 || index >= state.queue.length) return;
  const [item] = state.queue.splice(index, 1);
  state.queue.splice(index - 1, 0, item);
  saveQueue(state.queue);
  renderQueue();
  updateUpNext();
}

function updateQueueCount() {
  const count = state.queue.length;
  el.queueCount.textContent = String(count);
  el.queueCount.hidden = count === 0;
  el.railQueueCount.textContent = String(count);
  el.railQueueCount.hidden = count === 0;
  el.queueClear.disabled = count === 0;
}

function updateCounts() {
  updateQueueCount();
  el.historyClear.disabled = state.history.length === 0;
}

function updateUpNext() {
  if (!state.video) {
    el.upNext.hidden = true;
    return;
  }
  const next = state.queue.find((entry) => entry.id !== state.video?.id);
  if (!next) {
    el.upNext.hidden = true;
    return;
  }
  el.upNext.hidden = false;
  el.upNextTitle.textContent = next.title || "YouTube video";
  el.upNextSub.textContent = next.author || "YouTube";
  el.upNextThumb.src = next.thumbnail || thumbnailUrl(next.id, "mqdefault");
  el.upNextThumb.alt = "";
  el.upNextThumb.onerror = () => {
    el.upNextThumb.style.visibility = "hidden";
  };
  el.upNextPlay.onclick = () => playEntry(next, "queue");
  if (!next.title) hydrateEntryMeta(next.id, "queue");
}

function emptyList(iconName, title, text) {
  const wrap = document.createElement("div");
  wrap.className = "empty-list";
  const mark = document.createElement("div");
  mark.className = "empty-list-icon";
  mark.append(iconNode(iconName));
  const h2 = document.createElement("h2");
  h2.textContent = title;
  const p = document.createElement("p");
  p.textContent = text;
  wrap.append(mark, h2, p);
  if (iconName === "queue" && state.video) {
    const button = document.createElement("button");
    button.className = "btn subtle";
    button.type = "button";
    button.append(iconNode("plus"), document.createTextNode("Queue current video"));
    button.addEventListener("click", () => addToQueue({ id: state.video.id, title: state.meta?.title, author: state.meta?.author, start: state.startAt }));
    wrap.append(button);
  }
  return wrap;
}

function relative(timestamp) {
  const diff = Date.now() - Number(timestamp);
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(Number(timestamp)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ================================================================== */
/* Views + URL                                                        */
/* ================================================================== */

function switchView(view, { updateUrl = true } = {}) {
  if (!VIEWS.has(view)) view = "player";
  state.view = view;
  document.querySelectorAll(".view").forEach((section) => {
    section.hidden = section.dataset.view !== view;
  });
  document.querySelectorAll(".rail-btn[data-view], .side-item[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  el.crumb.textContent = VIEW_LABELS[view] || "Player";
  if (view === "queue") renderQueue();
  if (view === "history") renderHistory();
  if (view === "settings") syncSettingsUI();
  if (view === "player") scheduleRender();
  closeQualityMenu();
  el.views.scrollTop = 0;
  if (updateUrl) syncUrl();
}

function syncUrl() {
  const url = new URL(location.href);
  if (state.video) {
    url.searchParams.set("video", state.video.id);
    if (state.video.start > 0) url.searchParams.set("t", String(Math.floor(state.video.start)));
    else url.searchParams.delete("t");
  } else {
    url.searchParams.delete("video");
    url.searchParams.delete("t");
  }
  if (state.view !== "player") url.searchParams.set("view", state.view);
  else url.searchParams.delete("view");
  url.searchParams.delete("title");
  url.searchParams.delete("author");
  try {
    window.history.replaceState(null, "", url.toString());
  } catch {
    /* ignore */
  }
}

/* ================================================================== */
/* Inputs                                                             */
/* ================================================================== */

function bindInput(input, button, form) {
  input.addEventListener("input", () => {
    const parsed = parseVideo(input.value);
    if (button) button.disabled = !parsed;
    form?.classList.remove("invalid");
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const parsed = parseVideo(input.value);
    if (!parsed) {
      form.classList.add("invalid");
      setTimeout(() => form.classList.remove("invalid"), 420);
      toast("That doesn’t look like a YouTube link.", "bad");
      input.focus();
      return;
    }
    startFromInput(parsed, input);
  });
}

function startFromInput(parsed, input) {
  loadVideo(parsed, null, { prime: true, addHistory: true, autoplay: true });
  if (input) input.value = "";
}

/* ================================================================== */
/* Static events                                                      */
/* ================================================================== */

function bindEvents() {
  document.querySelectorAll(".rail-btn[data-view], .side-item[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  $("rail-logo").addEventListener("click", () => switchView("player"));
  el.btnTopSettings.addEventListener("click", () => switchView("settings"));
  el.btnHelp.addEventListener("click", openShortcuts);
  el.railHelp.addEventListener("click", openShortcuts);
  el.btnShortcuts.addEventListener("click", openShortcuts);

  el.btnPlay.addEventListener("click", togglePlay);
  el.centerPlay.addEventListener("click", () => {
    if (state.snapshot.ended) {
      if (state.player) {
        state.player.seekTo(0, true);
        state.snapshot.currentTime = 0;
      }
    }
    attemptPlay();
  });
  $("btn-back").addEventListener("click", () => seekTo((state.player?.getSnapshot().currentTime || 0) - 10));
  $("btn-forward").addEventListener("click", () => seekTo((state.player?.getSnapshot().currentTime || 0) + 10));
  el.btnMute.addEventListener("click", toggleMute);
  el.btnFullscreen.addEventListener("click", toggleFullscreen);

  el.btnQueue.addEventListener("click", () => {
    if (!state.video) return;
    addToQueue({
      id: state.video.id,
      title: state.meta?.title,
      author: state.meta?.author,
      thumbnail: state.meta?.thumbnail,
      start: state.startAt,
    });
  });
  el.btnCopy.addEventListener("click", copyCurrentLink);
  el.btnOpenYt.addEventListener("click", openOnYouTube);
  el.btnOpenYt2.addEventListener("click", openOnYouTube);
  el.btnReload.addEventListener("click", () => reloadVideo());
  el.btnReload2.addEventListener("click", () => reloadVideo());
  el.btnPrime.addEventListener("click", () => startPriming({ manual: true }));
  el.sidePrime.addEventListener("click", () => startPriming({ manual: true }));
  el.primeSkip.addEventListener("click", cancelPriming);
  el.errorRetry.addEventListener("click", () => reloadVideo({ keepTime: true }));
  el.errorYoutube.addEventListener("click", openOnYouTube);

  el.btnQuality.addEventListener("click", () => toggleQualityMenu());
  el.qualityMenu.querySelectorAll("[data-quality]").forEach((item) => {
    item.addEventListener("click", () => {
      changeQuality(item.dataset.quality);
      closeQualityMenu();
    });
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".quality-wrap")) closeQualityMenu();
  });

  el.seek.addEventListener("pointerdown", onSeekPointerDown);
  el.seek.addEventListener("pointermove", onSeekPointerMove);
  el.seek.addEventListener("pointerup", onSeekPointerUp);
  el.seek.addEventListener("pointercancel", onSeekPointerUp);
  el.seek.addEventListener("pointerleave", () => {
    if (!state.scrubbing) el.seekTip.style.opacity = "0";
  });
  el.seek.addEventListener("keydown", (event) => {
    const duration = state.snapshot.duration || 0;
    if (!duration) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekTo((state.snapshot.currentTime || 0) - 5);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      seekTo((state.snapshot.currentTime || 0) + 5);
    } else if (event.key === "Home") {
      event.preventDefault();
      seekTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      seekTo(duration);
    }
  });

  el.volume.addEventListener("pointerdown", onVolumePointerDown);
  el.volume.addEventListener("pointermove", onVolumePointerMove);
  el.volume.addEventListener("pointerup", onVolumePointerUp);
  el.volume.addEventListener("pointercancel", onVolumePointerUp);
  el.volume.addEventListener("keydown", (event) => {
    const current = state.settings.volume;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      changeVolume(current + 5, { unmute: true });
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      changeVolume(current - 5);
    } else if (event.key === "Home") {
      event.preventDefault();
      changeVolume(0);
    } else if (event.key === "End") {
      event.preventDefault();
      changeVolume(100, { unmute: true });
    }
  });

  el.heroForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const parsed = parseVideo(el.heroInput.value);
    if (!parsed) {
      el.heroForm.classList.add("invalid");
      setTimeout(() => el.heroForm.classList.remove("invalid"), 420);
      toast("That doesn’t look like a YouTube link.", "bad");
      el.heroInput.focus();
      return;
    }
    loadVideo(parsed, null, { prime: true, addHistory: true, autoplay: true });
    el.heroInput.value = "";
  });
  el.heroInput.addEventListener("input", () => {
    const parsed = parseVideo(el.heroInput.value);
    el.heroPlay.disabled = !parsed;
    el.heroForm.classList.remove("invalid");
  });

  bindInput(el.sideInput, el.sideLoad, el.sideForm);
  el.queueForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const parsed = parseVideo(el.queueInput.value);
    if (!parsed) {
      toast("That doesn’t look like a YouTube link.", "bad");
      el.queueInput.focus();
      return;
    }
    el.queueInput.value = "";
    const meta = await fetchVideoMeta(parsed.id, { timeout: 2500 }).catch(() => null);
    addToQueue({ id: parsed.id, start: parsed.start, title: meta?.title, author: meta?.author, thumbnail: meta?.thumbnail });
  });

  el.queueClear.addEventListener("click", async () => {
    if (!state.queue.length) return;
    const ok = await confirmAction({
      title: "Clear the queue?",
      message: `This removes ${state.queue.length} queued video${state.queue.length === 1 ? "" : "s"}. History is untouched.`,
      ok: "Clear queue",
      danger: true,
    });
    if (!ok) return;
    state.queue = [];
    await saveQueue(state.queue);
    updateQueueCount();
    updateUpNext();
    renderQueue();
    toast("Queue cleared", "good");
  });
  el.historyClear.addEventListener("click", clearHistory);
  $("settings-clear-history").addEventListener("click", clearHistory);
  $("settings-clear-queue").addEventListener("click", async () => {
    if (!state.queue.length) return;
    const ok = await confirmAction({
      title: "Clear the queue?",
      message: "All queued videos will be removed.",
      ok: "Clear queue",
      danger: true,
    });
    if (!ok) return;
    state.queue = [];
    await saveQueue(state.queue);
    updateQueueCount();
    updateUpNext();
    renderQueue();
    toast("Queue cleared", "good");
  });
  $("settings-reset").addEventListener("click", async () => {
    const ok = await confirmAction({
      title: "Reset settings?",
      message: "Playback, performance and interface settings return to their defaults. History and queue are kept.",
      ok: "Reset settings",
      danger: true,
    });
    if (!ok) return;
    state.settings = await resetSettings();
    state.h264Dirty = Boolean(state.video && state.loadedH264 !== null && state.settings.forceH264 !== state.loadedH264);
    applyReduceMotion();
    syncSettingsUI();
    updateChips();
    updateQualityMenu();
    if (state.player?.ready) {
      state.player.setVolume(state.settings.volume);
      state.player.setPlaybackQuality(qualityToApi(state.settings.quality));
    }
    toast("Settings reset to defaults", "good");
  });

  el.upNextPlay.addEventListener("click", () => {
    const next = state.queue.find((entry) => entry.id !== state.video?.id);
    if (next) playEntry(next, "queue");
  });

  document.querySelectorAll("[data-close-modal]").forEach((node) => node.addEventListener("click", closeModals));
  document.addEventListener("keydown", onKeyDown);
  document.querySelectorAll("[data-confirm]").forEach((node) => {
    node.addEventListener("click", () => resolveConfirm(false));
  });
  el.confirmCancel.addEventListener("click", () => resolveConfirm(false));
  el.confirmOk.addEventListener("click", () => resolveConfirm(true));
  document.addEventListener("fullscreenchange", () => {
    setIcon(el.fullscreenIcon, document.fullscreenElement ? "minimize" : "maximize");
  });
  el.miniThumb.addEventListener("error", () => el.miniThumb.classList.add("empty"));
}

/* ================================================================== */
/* Seek + volume pointers                                             */
/* ================================================================== */

function seekRatio(event) {
  const rect = el.seek.getBoundingClientRect();
  return clamp((event.clientX - rect.left) / rect.width, 0, 1);
}

function onSeekPointerDown(event) {
  if (!state.ready || !state.snapshot.duration) return;
  event.preventDefault();
  state.scrubbing = true;
  state.scrubTime = seekRatio(event) * state.snapshot.duration;
  el.seek.classList.add("scrubbing");
  el.seek.setPointerCapture?.(event.pointerId);
  updateScrubTip(seekRatio(event));
  scheduleRender();
}

function onSeekPointerMove(event) {
  if (!state.snapshot.duration) return;
  const ratio = seekRatio(event);
  updateScrubTip(ratio);
  if (!state.scrubbing) return;
  state.scrubTime = ratio * state.snapshot.duration;
  el.seekPlayed.style.width = `${(ratio * 100).toFixed(2)}%`;
  el.seekThumb.style.left = `${(ratio * 100).toFixed(2)}%`;
  el.timeCurrent.textContent = formatTime(state.scrubTime, { forceHours: state.snapshot.duration >= 3600 });
  scheduleRender();
}

function onSeekPointerUp(event) {
  if (!state.scrubbing) return;
  const ratio = seekRatio(event);
  const target = ratio * (state.snapshot.duration || 0);
  state.scrubbing = false;
  el.seek.classList.remove("scrubbing");
  try {
    el.seek.releasePointerCapture?.(event.pointerId);
  } catch {
    /* ignore */
  }
  el.seekTip.style.opacity = "0";
  seekTo(target);
}

function updateScrubTip(ratio) {
  const duration = state.snapshot.duration || 0;
  if (!duration) return;
  el.seekTip.style.left = `${(ratio * 100).toFixed(2)}%`;
  el.seekTip.textContent = formatTime(ratio * duration, { forceHours: duration >= 3600 });
  el.seekTip.style.opacity = "1";
}

function volumeRatio(event) {
  const rect = el.volume.getBoundingClientRect();
  return clamp((event.clientX - rect.left) / rect.width, 0, 1);
}

function onVolumePointerDown(event) {
  if (!state.ready) return;
  event.preventDefault();
  state.volumeDragging = true;
  el.volume.classList.add("active");
  el.volume.setPointerCapture?.(event.pointerId);
  changeVolume(volumeRatio(event) * 100, { persist: false, unmute: true });
}

function onVolumePointerMove(event) {
  if (!state.volumeDragging) return;
  changeVolume(volumeRatio(event) * 100, { persist: false, unmute: true });
}

function onVolumePointerUp(event) {
  if (!state.volumeDragging) return;
  state.volumeDragging = false;
  el.volume.classList.remove("active");
  try {
    el.volume.releasePointerCapture?.(event.pointerId);
  } catch {
    /* ignore */
  }
  changeVolume(volumeRatio(event) * 100, { persist: true, unmute: true });
}

/* ================================================================== */
/* Actions                                                            */
/* ================================================================== */

async function copyCurrentLink() {
  if (!state.video) return;
  const seconds = Math.floor(state.player?.getSnapshot().currentTime || 0);
  const url = watchUrl(state.video.id, seconds > 2 ? seconds : 0);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const area = document.createElement("textarea");
    area.value = url;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(seconds > 2 ? `Link copied at ${formatTime(seconds)}` : "Link copied", "good");
}

function openOnYouTube() {
  if (!state.video) return;
  const seconds = Math.floor(state.player?.getSnapshot().currentTime || 0);
  const url = watchUrl(state.video.id, seconds > 2 ? seconds : 0);
  try {
    if (typeof chrome !== "undefined" && chrome.tabs?.create) chrome.tabs.create({ url });
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function clearHistory() {
  if (!state.history.length) return;
  const ok = await confirmAction({
    title: "Clear history?",
    message: "This removes every video from your local history. Your queue and settings stay as they are.",
    ok: "Clear history",
    danger: true,
  });
  if (!ok) return;
  state.history = [];
  await saveHistory(state.history);
  renderHistory();
  updateCounts();
  toast("History cleared", "good");
}

/* ================================================================== */
/* Quality menu                                                       */
/* ================================================================== */

function toggleQualityMenu() {
  state.qualityMenuOpen ? closeQualityMenu() : openQualityMenu();
}

function openQualityMenu() {
  state.qualityMenuOpen = true;
  el.qualityMenu.hidden = false;
  el.btnQuality.setAttribute("aria-expanded", "true");
  updateQualityMenu();
}

function closeQualityMenu() {
  if (!state.qualityMenuOpen) return;
  state.qualityMenuOpen = false;
  el.qualityMenu.hidden = true;
  el.btnQuality.setAttribute("aria-expanded", "false");
}

/* ================================================================== */
/* Modals                                                             */
/* ================================================================== */

function openShortcuts() {
  closeModals();
  el.shortcutsModal.hidden = false;
}

function closeModals() {
  el.shortcutsModal.hidden = true;
  if (!el.confirmModal.hidden) resolveConfirm(false);
}

function confirmAction({ title, message, ok = "Confirm", danger = false }) {
  if (state.confirmResolver) {
    state.confirmResolver(false);
    state.confirmResolver = null;
  }
  return new Promise((resolve) => {
    state.confirmResolver = resolve;
    el.confirmTitle.textContent = title;
    el.confirmMessage.textContent = message;
    el.confirmOk.textContent = ok;
    el.confirmOk.className = `btn ${danger ? "danger-solid" : "primary"}`;
    el.confirmModal.hidden = false;
    setTimeout(() => el.confirmCancel.focus(), 20);
  });
}

function resolveConfirm(result) {
  const resolve = state.confirmResolver;
  state.confirmResolver = null;
  el.confirmModal.hidden = true;
  if (resolve) resolve(Boolean(result));
}

/* ================================================================== */
/* Keyboard                                                           */
/* ================================================================== */

function onKeyDown(event) {
  if (event.key === "Escape") {
    if (!el.confirmModal.hidden) {
      resolveConfirm(false);
      return;
    }
    if (!el.shortcutsModal.hidden) {
      closeModals();
      return;
    }
    if (state.qualityMenuOpen) {
      closeQualityMenu();
      return;
    }
  }

  if (!el.confirmModal.hidden || !el.shortcutsModal.hidden) return;

  const target = event.target;
  const tag = target?.tagName;
  const inputType = target?.type;
  const isTextField =
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target?.isContentEditable ||
    (tag === "INPUT" && !["checkbox", "radio", "range", "button", "submit"].includes(inputType));
  if (isTextField) return;
  if ((tag === "BUTTON" || tag === "A") && (event.key === " " || event.key === "Enter")) return;
  if ((inputType === "checkbox" || inputType === "radio") && (event.key === " " || event.key === "Enter")) return;
  if (inputType === "range" || target?.getAttribute?.("role") === "slider") return;

  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.key.toLowerCase() === "r" && state.video) {
    event.preventDefault();
    reloadVideo();
    return;
  }

  if (event.key === "?") {
    event.preventDefault();
    openShortcuts();
    return;
  }

  if (state.view !== "player") {
    if (event.key === "1") {
      event.preventDefault();
      switchView("player");
    } else if (event.key.toLowerCase() === "q") {
      event.preventDefault();
      switchView("queue");
    } else if (event.key.toLowerCase() === "h") {
      event.preventDefault();
      switchView("history");
    } else if (event.key === "4") {
      event.preventDefault();
      switchView("settings");
    }
    return;
  }

  if (event.key === " " || event.key.toLowerCase() === "k") {
    if (event.repeat) return;
    event.preventDefault();
    togglePlay();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    seekTo((state.snapshot.currentTime || 0) - 5);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    seekTo((state.snapshot.currentTime || 0) + 5);
  } else if (event.key.toLowerCase() === "j") {
    event.preventDefault();
    seekTo((state.snapshot.currentTime || 0) - 10);
  } else if (event.key.toLowerCase() === "l") {
    event.preventDefault();
    seekTo((state.snapshot.currentTime || 0) + 10);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    changeVolume(state.settings.volume + 5, { unmute: true });
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    changeVolume(state.settings.volume - 5);
  } else if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    toggleMute();
  } else if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    toggleFullscreen();
  } else if (event.key.toLowerCase() === "p") {
    event.preventDefault();
    if (!state.priming) startPriming({ manual: true });
  } else if (event.key.toLowerCase() === "r") {
    event.preventDefault();
    reloadVideo();
  } else if (event.key.toLowerCase() === "q") {
    event.preventDefault();
    switchView("queue");
  } else if (event.key.toLowerCase() === "h") {
    event.preventDefault();
    switchView("history");
  } else if (/^[0-9]$/.test(event.key) && state.snapshot.duration) {
    event.preventDefault();
    seekTo((Number(event.key) / 10) * state.snapshot.duration);
  }
}

/* ================================================================== */
/* Helpers                                                            */
/* ================================================================== */

function iconNode(name) {
  const span = document.createElement("span");
  setIcon(span, name);
  return span;
}

function showEmpty() {
  state.video = null;
  state.meta = null;
  state.stageError = null;
  state.wantsPlay = false;
  state.snapshot = emptySnapshot();
  el.stage.classList.remove("has-video", "is-playing", "is-priming", "has-error", "is-buffering");
  el.underStage.hidden = true;
  el.upNext.hidden = true;
  el.mini.classList.remove("playing");
  el.emptyStage.hidden = false;
  el.primeOverlay.hidden = true;
  el.stageError.hidden = true;
  el.centerPlay.hidden = true;
  el.buffering.hidden = true;
  el.nowTitle.textContent = "Nothing playing yet";
  el.nowAuthor.textContent = "Paste a YouTube link to begin";
  el.nowId.textContent = "—";
  el.miniTitle.textContent = "Nothing yet";
  el.miniSub.textContent = "Paste a link to start";
  el.miniThumb.removeAttribute("src");
  el.miniThumb.closest(".mini-thumb")?.classList.add("empty");
  document.title = "LagFree — Smooth YouTube Player";
  setTopStatus("idle", "Idle");
  setEngine("idle", "Idle");
  setStatusLine("No video loaded");
  el.statusBuffer.textContent = "Buffer —";
  el.statusQuality.textContent = "—";
  el.inspLoaded.textContent = "0%";
  el.inspQuality.textContent = "—";
  el.inspStalls.textContent = "0";
  el.engineAhead.textContent = "0";
  el.engineMeter.style.width = "0%";
  el.bufferChipText.textContent = "Buffered 0s";
  el.timeCurrent.textContent = "0:00";
  el.timeDuration.textContent = "0:00";
  el.seekPlayed.style.width = "0%";
  el.seekBuffer.style.width = "0%";
  el.seekThumb.style.left = "0%";
  updateActionButtons();
  updateUpNext();
  scheduleRender();
}

function updateClock() {
  el.statusClock.textContent = new Date().toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toast(message, tone = "info") {
  if (!message) return;
  while (el.toasts.children.length >= 3) el.toasts.firstElementChild.remove();
  const item = document.createElement("div");
  item.className = `toast-item ${tone}`;
  const iconName = tone === "good" ? "check" : tone === "bad" ? "alert" : tone === "busy" ? "refresh" : "info";
  item.append(iconNode(iconName));
  const text = document.createElement("span");
  text.textContent = message;
  item.append(text);
  el.toasts.append(item);
  setTimeout(() => {
    item.classList.add("leaving");
    setTimeout(() => item.remove(), 220);
  }, 3200);
}

function bindStorageSync() {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.queue?.newValue) {
      state.queue = Array.isArray(changes.queue.newValue) ? changes.queue.newValue : [];
      updateQueueCount();
      updateUpNext();
      if (state.view === "queue") renderQueue();
    }
    if (changes.history?.newValue) {
      state.history = Array.isArray(changes.history.newValue) ? changes.history.newValue : [];
      updateCounts();
      if (state.view === "history") renderHistory();
    }
    if (changes.settings?.newValue) {
      state.settings = normalizeSettings(changes.settings.newValue);
      if (state.video && state.loadedH264 !== null) {
        state.h264Dirty = state.settings.forceH264 !== state.loadedH264;
      }
      applyReduceMotion();
      syncSettingsUI();
      updateChips();
      if (state.player?.ready) {
        state.player.setVolume(state.settings.volume);
      }
      scheduleRender();
    }
  });
}
