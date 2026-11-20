import { getStored, setStored } from "./storage.js";

const MEMORY = new Map();
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

export function metaKey(id) {
  return `meta:${id}`;
}

/**
 * Fetch title / channel via YouTube's public oEmbed endpoint.
 * Returns null on failure (private, age-restricted, offline...).
 */
export async function fetchVideoMeta(id, { timeout = 4000 } = {}) {
  if (!id) return null;
  if (MEMORY.has(id)) return MEMORY.get(id);

  const key = metaKey(id);
  try {
    const cached = (await getStored(key))[key];
    if (cached && cached.at && cached.data && Date.now() - cached.at < CACHE_MS) {
      MEMORY.set(id, cached.data);
      return cached.data;
    }
  } catch {
    /* ignore cache errors */
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${id}`
    )}&format=json`;
    const response = await fetch(oembed, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
    if (!response.ok) throw new Error(`oembed ${response.status}`);
    const data = await response.json();
    const meta = {
      title: String(data.title || "").trim().slice(0, 300),
      author: String(data.author_name || "").trim().slice(0, 160),
      thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    };
    if (!meta.title) throw new Error("empty title");
    MEMORY.set(id, meta);
    setStored({ [key]: { at: Date.now(), data: meta } }).catch(() => {});
    return meta;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function rememberMetaInMemory(id, meta) {
  if (id && meta) MEMORY.set(id, meta);
}
