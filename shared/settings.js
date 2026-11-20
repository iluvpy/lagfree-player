import { getStored, setStored } from "./storage.js";
import { clamp } from "./utils.js";

export const DEFAULT_SETTINGS = Object.freeze({
  forceH264: true,
  adaptiveQuality: true,
  prebufferSeconds: 6,
  quality: "hd720",
  autoPlayAfterBuffer: false,
  startMuted: false,
  rememberHistory: true,
  reduceMotion: false,
  lagGuard: "balanced",
  downloadQuality: "1080",
  volume: 100,
  muted: false,
});

export const QUALITY_OPTIONS = [
  { value: "auto", label: "Auto", hint: "Let YouTube decide" },
  { value: "hd1080", label: "1080p", hint: "Sharp, more work" },
  { value: "hd720", label: "720p", hint: "Recommended for older laptops" },
  { value: "large", label: "480p", hint: "Data saver" },
  { value: "medium", label: "360p", hint: "Lowest" },
];

export const LAG_GUARD_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "balanced", label: "Balanced" },
  { value: "aggressive", label: "Aggressive" },
];

export const DOWNLOAD_QUALITY_OPTIONS = [
  { value: "1080", label: "1080p MP4", hint: "H.264 + AAC, best compatibility" },
  { value: "720", label: "720p MP4", hint: "Smaller file, H.264 + AAC" },
  { value: "best", label: "Best available", hint: "Up to 4K, saved as MKV" },
  { value: "audio", label: "Audio only", hint: "M4A audio, no video" },
];

const VALID_QUALITY = new Set(QUALITY_OPTIONS.map((item) => item.value));
const VALID_GUARD = new Set(LAG_GUARD_OPTIONS.map((item) => item.value));
const VALID_DOWNLOAD_QUALITY = new Set(DOWNLOAD_QUALITY_OPTIONS.map((item) => item.value));

export function normalizeSettings(raw = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === "object" ? raw : {}) };
  return {
    ...merged,
    forceH264: Boolean(merged.forceH264),
    adaptiveQuality: Boolean(merged.adaptiveQuality),
    autoPlayAfterBuffer: Boolean(merged.autoPlayAfterBuffer),
    startMuted: Boolean(merged.startMuted),
    rememberHistory: Boolean(merged.rememberHistory),
    reduceMotion: Boolean(merged.reduceMotion),
    muted: Boolean(merged.muted),
    prebufferSeconds: clamp(Number(merged.prebufferSeconds) || 0, 0, 20),
    quality: VALID_QUALITY.has(merged.quality) ? merged.quality : DEFAULT_SETTINGS.quality,
    lagGuard: VALID_GUARD.has(merged.lagGuard) ? merged.lagGuard : DEFAULT_SETTINGS.lagGuard,
    downloadQuality: VALID_DOWNLOAD_QUALITY.has(merged.downloadQuality)
      ? merged.downloadQuality
      : DEFAULT_SETTINGS.downloadQuality,
    volume: clamp(Number(merged.volume) || 0, 0, 100),
  };
}

export async function getSettings() {
  const stored = await getStored("settings");
  return normalizeSettings(stored.settings);
}

/**
 * Merge a patch into persisted settings. Returns the normalized result.
 */
export async function saveSettings(patch) {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...patch });
  await setStored({ settings: next });
  return next;
}

export async function resetSettings() {
  const next = { ...DEFAULT_SETTINGS };
  await setStored({ settings: next });
  return next;
}

export function qualityToApi(value) {
  return value === "auto" ? "default" : value;
}

export function qualityLabel(value) {
  const item = QUALITY_OPTIONS.find((option) => option.value === value);
  return item ? item.label : value;
}

export function loadHistoryAndQueue() {
  return getStored(["history", "queue"]).then((data) => ({
    history: Array.isArray(data.history) ? data.history.filter(isValidEntry) : [],
    queue: Array.isArray(data.queue) ? data.queue.filter(isValidEntry) : [],
  }));
}

export async function saveHistory(history) {
  await setStored({ history: history.slice(0, 60) });
}

export async function saveQueue(queue) {
  await setStored({ queue: queue.slice(0, 60) });
}

export function isValidEntry(entry) {
  return Boolean(entry && typeof entry.id === "string" && /^[A-Za-z0-9_-]{11}$/.test(entry.id));
}
