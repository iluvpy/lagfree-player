/* chrome.storage.local with a localStorage fallback so the player page can also
   run as a plain static site while developing or self-hosting. */

const PREFIX = "lagfree:";

export function hasExtensionStorage() {
  try {
    return typeof chrome !== "undefined" && !!chrome.storage?.local;
  } catch {
    return false;
  }
}

function localKey(key) {
  return PREFIX + key;
}

function localGet(key) {
  try {
    const raw = localStorage.getItem(localKey(key));
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function localSet(key, value) {
  try {
    localStorage.setItem(localKey(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function localRemove(key) {
  try {
    localStorage.removeItem(localKey(key));
    return true;
  } catch {
    return false;
  }
}

export async function getStored(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  if (hasExtensionStorage()) {
    try {
      return await chrome.storage.local.get(keys);
    } catch {
      /* fall through */
    }
  }
  const result = {};
  for (const key of list) {
    const value = localGet(key);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export async function setStored(values) {
  if (hasExtensionStorage()) {
    try {
      await chrome.storage.local.set(values);
      return true;
    } catch {
      /* fall through */
    }
  }
  let ok = true;
  for (const [key, value] of Object.entries(values)) {
    if (!localSet(key, value)) ok = false;
  }
  return ok;
}

export async function removeStored(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  if (hasExtensionStorage()) {
    try {
      await chrome.storage.local.remove(list);
      return true;
    } catch {
      /* fall through */
    }
  }
  let ok = true;
  for (const key of list) if (!localRemove(key)) ok = false;
  return ok;
}

export async function clearAllStored() {
  if (hasExtensionStorage()) {
    try {
      await chrome.storage.local.clear();
      return true;
    } catch {
      /* fall through */
    }
  }
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}
