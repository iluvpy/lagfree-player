import { embedUrl, clamp } from "../shared/utils.js";

/**
 * A tiny YouTube embed bridge built on the public postMessage protocol.
 *
 * We intentionally do not load https://www.youtube.com/iframe_api: MV3 forbids
 * remote scripts on extension pages. The embed's own postMessage API gives us
 * playback control, timing, buffered fraction and quality data.
 */
export class YTPlayer extends EventTarget {
  static nextId = 1;

  constructor(container, { videoId, start = 0, h264 = false, title = "YouTube video", quality = "auto" }) {
    super();
    this.container = container;
    this.videoId = videoId;
    this.start = Math.max(0, Number(start) || 0);
    this.h264 = Boolean(h264);
    this.initialQuality = quality;
    this.instanceId = `lf-yt-${YTPlayer.nextId++}`;

    this.iframe = null;
    this.ready = false;
    this.destroyed = false;
    this.desiredPlaying = false;
    this.currentTime = this.start;
    this.duration = 0;
    this.loadedFraction = 0;
    this.playerState = 5;
    this.playbackQuality = "unknown";
    this.availableQualityLevels = [];
    this.volume = 100;
    this.muted = false;
    this.playbackRate = 1;
    this.videoData = null;
    this.error = null;
    this.lastProgressAt = 0;
    this.lastProgressTime = -1;
    this.stateChangedAt = performance.now();
    this.playblockedNotified = false;

    this._queue = [];
    this._listeners = [];
    this._timers = new Set();
    this._watchdog = null;
    this._listenTimer = null;
    this._onIframeLoad = this._onIframeLoad.bind(this);
    this._onWindowMessage = this._onWindowMessage.bind(this);

    this._build();
  }

  /* ------------------------------------------------------------------ */
  /* Setup                                                              */
  /* ------------------------------------------------------------------ */

  _build() {
    const iframe = document.createElement("iframe");
    iframe.className = "yt-frame";
    iframe.title = "YouTube video player";
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    iframe.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    );
    iframe.setAttribute("playsinline", "1");
    iframe.allowFullscreen = true;

    const url = new URL(embedUrl(this.videoId, { start: this.start, h264: this.h264, quality: this.initialQuality }));
    try {
      if (location.origin && location.origin !== "null") url.searchParams.set("origin", location.origin);
    } catch {
      /* ignore */
    }
    iframe.src = url.toString();
    iframe.addEventListener("load", this._onIframeLoad);
    this.iframe = iframe;
    this.container.replaceChildren(iframe);
    window.addEventListener("message", this._onWindowMessage);

    // Listening handshake: the embed starts delivering events once it receives
    // this. Retry until ready in case the first messages race the player boot.
    this._listenTimer = setInterval(() => {
      if (this.ready || this.destroyed) {
        this._stopListening();
        return;
      }
      this._post({ event: "listening", id: this.instanceId, channel: "widget" });
    }, 450);

    this._watchdog = setInterval(() => this._tick(), 500);
    this._timeout = setTimeout(() => {
      if (!this.ready && !this.destroyed) this._emit("timeout", { videoId: this.videoId });
    }, 15000);
  }

  _onIframeLoad() {
    if (this.destroyed) return;
    this._post({ event: "listening", id: this.instanceId, channel: "widget" });
    this._later(() => this._post({ event: "listening", id: this.instanceId, channel: "widget" }), 250);
    this._later(() => this._post({ event: "listening", id: this.instanceId, channel: "widget" }), 900);
  }

  _post(payload) {
    if (this.destroyed || !this.iframe?.contentWindow) return;
    try {
      this.iframe.contentWindow.postMessage(JSON.stringify(payload), "*");
    } catch {
      /* frame may be mid-navigation */
    }
  }

  _command(func, args = []) {
    if (!this.ready) {
      this._queue.push({ func, args });
      return;
    }
    this._post({ event: "command", func, args });
  }

  _flush() {
    const queue = this._queue.splice(0);
    for (const item of queue) this._post({ event: "command", func: item.func, args: item.args });
  }

  _later(fn, ms) {
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      if (!this.destroyed) fn();
    }, ms);
    this._timers.add(timer);
    return timer;
  }

  _stopListening() {
    if (this._listenTimer) {
      clearInterval(this._listenTimer);
      this._listenTimer = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Messages                                                           */
  /* ------------------------------------------------------------------ */

  _onWindowMessage(event) {
    if (this.destroyed) return;
    if (!this.iframe || event.source !== this.iframe.contentWindow) return;
    let data = event.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!data || typeof data !== "object" || typeof data.event !== "string") return;

    switch (data.event) {
      case "initialDelivery":
        this._mergeInfo(data.info || {});
        break;
      case "onReady":
        this._handleReady();
        break;
      case "infoDelivery":
      case "apiInfoDelivery":
        this._mergeInfo(data.info || {});
        break;
      case "onStateChange":
        this._syncState(Number(data.info), { fromPlayer: true });
        break;
      case "onError":
        this._handleError(Number(data.info));
        break;
      case "onPlaybackQualityChange":
        if (data.info && data.info !== this.playbackQuality) {
          this.playbackQuality = data.info;
          this._emit("qualitychange", { quality: this.playbackQuality });
        }
        break;
      case "onPlaybackRateChange":
        this.playbackRate = Number(data.info) || 1;
        break;
      case "onVolumeChange":
        if (data.info && typeof data.info === "object") {
          if (typeof data.info.volume === "number") this.volume = data.info.volume;
          if (typeof data.info.muted === "boolean") this.muted = data.info.muted;
        }
        break;
      default:
        break;
    }

    this._emit("message", { event: data.event });
  }

  _handleReady() {
    if (this.ready) return;
    this.ready = true;
    clearTimeout(this._timeout);
    this._stopListening();
    if (this.start > 0) this.seekTo(this.start, true);
    this._flush();
    this._emit("ready", this.getSnapshot());
    this._emit("statechange", { state: this.playerState, previous: 5, playing: false });
  }

  _mergeInfo(info) {
    if (!info || typeof info !== "object") return;
    let shouldEmit = false;

    if (typeof info.currentTime === "number" && Number.isFinite(info.currentTime)) {
      const previous = this.currentTime;
      this.currentTime = info.currentTime;
      if (info.currentTime > previous + 0.02) {
        this.lastProgressTime = info.currentTime;
        this.lastProgressAt = performance.now();
        if (this.playerState !== 1 && this.playerState !== 2 && !this.error) {
          this._syncState(1);
        }
      }
      shouldEmit = true;
    }
    if (typeof info.duration === "number" && info.duration > 0) {
      this.duration = info.duration;
      shouldEmit = true;
    }
    if (typeof info.videoLoadedFraction === "number") {
      this.loadedFraction = clamp(info.videoLoadedFraction, 0, 1);
      shouldEmit = true;
    } else if (typeof info.loadedFraction === "number") {
      this.loadedFraction = clamp(info.loadedFraction, 0, 1);
      shouldEmit = true;
    }
    if (Array.isArray(info.availableQualityLevels)) {
      this.availableQualityLevels = info.availableQualityLevels.slice();
      shouldEmit = true;
    }
    if (typeof info.playbackQuality === "string" && info.playbackQuality !== "unknown") {
      if (info.playbackQuality !== this.playbackQuality) {
        this.playbackQuality = info.playbackQuality;
        this._emit("qualitychange", { quality: this.playbackQuality });
      }
      shouldEmit = true;
    }
    if (typeof info.muted === "boolean") {
      this.muted = info.muted;
      shouldEmit = true;
    }
    if (typeof info.volume === "number") {
      this.volume = info.volume;
      shouldEmit = true;
    }
    if (typeof info.playbackRate === "number") this.playbackRate = info.playbackRate;
    if (info.videoData && typeof info.videoData === "object") {
      this.videoData = info.videoData;
      if (typeof info.videoData.errorCode === "string" && info.videoData.errorCode) {
        this.error = info.videoData.errorCode;
      }
    }
    if (typeof info.playerState === "number") {
      this._syncState(info.playerState);
    }

    if (shouldEmit) this._emit("info", this.getSnapshot());
  }

  _syncState(state, { fromPlayer = false } = {}) {
    if (!Number.isFinite(state) || state < 0) return;
    if (state === 1 || state === 2 || state === 0) this.playblockedNotified = false;
    if (fromPlayer && state === 3) {
      // Buffering is inferred locally as well; don't flap.
    }
    if (state === 0) {
      this.desiredPlaying = false;
      this.currentTime = this.duration || this.currentTime;
    } else if (state === 1) {
      this.desiredPlaying = true;
    } else if (state === 2 || state === 5) {
      this.desiredPlaying = false;
    } else if (state === 3) {
      this.desiredPlaying = true;
    }
    if (state === this.playerState) return;
    const previous = this.playerState;
    this.playerState = state;
    this.stateChangedAt = performance.now();
    this._emit("statechange", {
      state,
      previous,
      playing: state === 1,
      buffering: state === 3,
      ended: state === 0,
    });
    this._emit("info", this.getSnapshot());
  }

  _tick() {
    if (this.destroyed) return;
    if (!this.ready) return;
    const now = performance.now();

    const progressed = this.currentTime > this.lastProgressTime + 0.03;
    if (progressed) {
      this.lastProgressTime = this.currentTime;
      this.lastProgressAt = now;
      if (this.playerState !== 1 && this.playerState !== 2 && this.playerState !== 0) this._syncState(1);
    } else if (this.desiredPlaying && now - this.lastProgressAt > 1300 && this.playerState !== 3) {
      this._syncState(3);
    }

    if (this.duration > 0 && this.currentTime >= this.duration - 0.35 && this.desiredPlaying) {
      this.desiredPlaying = false;
      this._syncState(0);
    }

    if (!this.playblockedNotified && this.desiredPlaying && now - this.lastProgressAt > 4000 && this.playerState === 3) {
      this.playblockedNotified = true;
      this._emit("playblocked", { currentTime: this.currentTime });
    }

    this._emit("info", this.getSnapshot());
  }

  _handleError(code) {
    const messages = {
      2: "Invalid video request.",
      5: "This video can’t be played in the embedded player.",
      100: "This video is unavailable or private.",
      101: "The owner doesn’t allow this video to be embedded.",
      150: "The owner doesn’t allow this video to be embedded.",
      152: "YouTube rejected the embed request. Reload LagFree or the page and try again.",
      153: "YouTube requires a referrer for embeds. LagFree’s referrer rule may not have loaded — reload the extension and try again.",
    };
    this.error = { code, message: messages[code] || `Playback error ${code}.` };
    this.desiredPlaying = false;
    this._emit("error", this.error);
  }

  getSnapshot() {
    const buffered = this.duration > 0 ? this.loadedFraction * this.duration : 0;
    return {
      ready: this.ready,
      currentTime: this.currentTime,
      duration: this.duration,
      loadedFraction: this.loadedFraction,
      bufferedSeconds: Math.max(0, buffered - this.currentTime),
      playerState: this.playerState,
      playing: this.playerState === 1,
      buffering: this.playerState === 3,
      ended: this.playerState === 0,
      playbackQuality: this.playbackQuality,
      availableQualityLevels: this.availableQualityLevels,
      volume: this.volume,
      muted: this.muted,
      playbackRate: this.playbackRate,
      videoData: this.videoData,
      error: this.error,
    };
  }

  _emit(name, detail) {
    try {
      this.dispatchEvent(new CustomEvent(name, { detail }));
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public controls                                                    */
  /* ------------------------------------------------------------------ */

  play() {
    this.desiredPlaying = true;
    this.lastProgressAt = performance.now();
    this._syncState(3);
    this._command("playVideo");
  }

  pause() {
    this.desiredPlaying = false;
    this._command("pauseVideo");
    this._syncState(2);
  }

  toggle() {
    if (this.playerState === 1 || this.playerState === 3) this.pause();
    else this.play();
  }

  seekTo(seconds, allowSeekAhead = true) {
    const target = Math.max(0, Number(seconds) || 0);
    this.currentTime = target;
    this.lastProgressTime = target - 0.1;
    this.lastProgressAt = performance.now();
    this._command("seekTo", [target, Boolean(allowSeekAhead)]);
    if (this.desiredPlaying) this._syncState(3);
  }

  mute() {
    this.muted = true;
    this._command("mute");
    this._emit("volumechange", { muted: true, volume: this.volume });
  }

  unMute() {
    this.muted = false;
    this._command("unMute");
    this._emit("volumechange", { muted: false, volume: this.volume });
  }

  setVolume(value) {
    this.volume = clamp(Number(value) || 0, 0, 100);
    this._command("setVolume", [this.volume]);
    this._emit("volumechange", { muted: this.muted, volume: this.volume });
  }

  setPlaybackQuality(quality) {
    if (!quality) return;
    this._command("setPlaybackQuality", [quality]);
    this.playbackQuality = quality === "default" ? "auto" : quality;
  }

  setPlaybackRate(rate) {
    this._command("setPlaybackRate", [Number(rate) || 1]);
  }

  destroy() {
    this.destroyed = true;
    this._stopListening();
    clearTimeout(this._timeout);
    if (this._watchdog) clearInterval(this._watchdog);
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear();
    window.removeEventListener("message", this._onWindowMessage);
    if (this.iframe) {
      this.iframe.removeEventListener("load", this._onIframeLoad);
      this.iframe.remove();
    }
    this.iframe = null;
    this._queue.length = 0;
  }
}
