/* Small, dependency-free helpers shared by the popup and the player. */

export const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const YT_HOSTS = new Set([
  "youtube.com",
  "youtube-nocookie.com",
]);

function normalizeHost(hostname) {
  return hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
}

function hostMatches(host, base) {
  return host === base || host.endsWith("." + base);
}

export function parseTimeToken(value) {
  if (value === null || value === undefined) return 0;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return 0;
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.floor(Number(raw));
  // Supports 1h2m3s, 2m30s, 90s, 1h.
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match || (!match[1] && !match[2] && !match[3])) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

/**
 * Accepts a full YouTube URL, a URL without a scheme, or a bare 11-char id.
 * Returns { id, start } or null.
 */
export function parseVideo(input) {
  if (!input) return null;
  const raw = String(input).trim().replace(/^<|>$/g, "");
  if (!raw) return null;

  if (YT_ID_RE.test(raw)) return { id: raw, start: 0 };

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = normalizeHost(url.hostname);
  const parts = url.pathname.split("/").filter(Boolean);
  let id = null;

  if (host === "youtu.be") {
    id = parts[0] || null;
  } else if (YT_HOSTS.has(host) || hostMatches(host, "youtube.com") || hostMatches(host, "youtube-nocookie.com")) {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v");
    } else if (parts[0] === "shorts" || parts[0] === "live" || parts[0] === "embed" || parts[0] === "v") {
      id = parts[1] || null;
    }
  }

  if (!id || !YT_ID_RE.test(id)) return null;

  let start = 0;
  for (const key of ["t", "start", "time_continue"]) {
    const candidate = url.searchParams.get(key);
    if (candidate) {
      start = parseTimeToken(candidate);
      if (start > 0) break;
    }
  }
  if (!start) {
    const hash = url.hash.replace(/^#/, "");
    if (hash) {
      const hashParams = new URLSearchParams(hash);
      const candidate = hashParams.get("t") || hashParams.get("start");
      if (candidate) start = parseTimeToken(candidate);
    }
  }

  return { id, start };
}

export function watchUrl(id, start = 0) {
  const base = `https://www.youtube.com/watch?v=${id}`;
  return start > 0 ? `${base}&t=${Math.floor(start)}s` : base;
}

export function embedUrl(id, { start = 0, h264 = false, autoplay = false, quality = "auto" } = {}) {
  const params = new URLSearchParams({
    enablejsapi: "1",
    autoplay: autoplay ? "1" : "0",
    controls: "0",
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    iv_load_policy: "3",
    showinfo: "0",
    fs: "0",
    lagfree: "1",
  });
  if (start > 0) params.set("start", String(Math.floor(start)));
  if (h264) params.set("lagfree_h264", "1");
  if (quality && quality !== "auto") params.set("vq", quality);
  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}

export function thumbnailUrl(id, quality = "mqdefault") {
  return `https://i.ytimg.com/vi/${id}/${quality}.jpg`;
}

export function stripYouTubeTitle(title) {
  if (!title) return "";
  return String(title)
    .replace(/^\(\d+\+?\)\s*/, "")
    .replace(/\s*[-–—]\s*YouTube(?:\s+Music)?\s*$/i, "")
    .replace(/\s*[-–—]\s*YouTube\s*$/i, "")
    .trim();
}

export function formatTime(value, { forceHours = false } = {}) {
  let seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  seconds = Math.floor(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0 || forceHours) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function clockTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatRelative(timestamp) {
  const ts = Number(timestamp);
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 45_000) return "just now";
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateTime(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCount(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitFor(predicate, { timeout = 8000, interval = 100 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      let result = false;
      try {
        result = predicate();
      } catch {
        result = false;
      }
      if (result) return resolve(true);
      if (Date.now() - started >= timeout) return resolve(false);
      setTimeout(tick, interval);
    };
    tick();
  });
}

export function debounce(fn, delay = 200) {
  let timer = 0;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function throttle(fn, delay = 100) {
  let last = 0;
  let timer = 0;
  return (...args) => {
    const now = Date.now();
    const remaining = delay - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, remaining);
    }
  };
}

export function friendlyQuality(value) {
  const map = {
    highres: "4K+",
    hd2160: "2160p",
    hd1440: "1440p",
    hd1080: "1080p",
    hd720: "720p",
    large: "480p",
    medium: "360p",
    small: "240p",
    tiny: "144p",
    auto: "Auto",
    default: "Auto",
    unknown: "—",
  };
  return map[value] || value || "—";
}

export function sizeLabel(quality) {
  switch (quality) {
    case "highres":
    case "hd2160":
      return "4K";
    case "hd1440":
      return "1440p";
    case "hd1080":
      return "1080p";
    case "hd720":
      return "720p";
    case "large":
      return "480p";
    case "medium":
      return "360p";
    case "small":
      return "240p";
    case "tiny":
      return "144p";
    default:
      return "Auto";
  }
}
