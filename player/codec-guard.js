/*
 * LagFree codec guard — runs inside the YouTube embed (MAIN world) only when
 * the embed URL carries lagfree_h264=1. It makes VP8/VP9/AV1 look unsupported,
 * nudging YouTube toward H.264, which is much lighter to decode on older GPUs.
 *
 * This is the same idea used by h264ify-style extensions, scoped only to
 * LagFree's own player embeds.
 */
(() => {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get("lagfree_h264") !== "1") return;
    if (window.__lagfreeCodecGuard) return;
    window.__lagfreeCodecGuard = true;

    const isBlocked = (type) => {
      const value = String(type || "");
      if (!value) return false;
      return /vp0?8|vp0?9|av01/i.test(value);
    };

    if (window.MediaSource && typeof window.MediaSource.isTypeSupported === "function") {
      const original = window.MediaSource.isTypeSupported.bind(window.MediaSource);
      window.MediaSource.isTypeSupported = (type) => {
        if (isBlocked(type)) return false;
        try {
          return original(type);
        } catch {
          return false;
        }
      };
    }

    if (window.MediaSource && window.MediaSource.prototype?.addSourceBuffer) {
      const originalAdd = window.MediaSource.prototype.addSourceBuffer;
      window.MediaSource.prototype.addSourceBuffer = function addSourceBuffer(type) {
        if (isBlocked(type)) {
          throw new DOMException("LagFree: codec blocked", "NotSupportedError");
        }
        return originalAdd.apply(this, arguments);
      };
    }

    if (window.HTMLMediaElement?.prototype?.canPlayType) {
      const originalCanPlay = window.HTMLMediaElement.prototype.canPlayType;
      window.HTMLMediaElement.prototype.canPlayType = function canPlayType(type) {
        if (isBlocked(type)) return "";
        try {
          return originalCanPlay.apply(this, arguments);
        } catch {
          return "";
        }
      };
    }

    // Some players check navigator.mediaCapabilities instead of MediaSource.
    if (navigator.mediaCapabilities && typeof navigator.mediaCapabilities.decodingInfo === "function") {
      const originalDecodingInfo = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
      navigator.mediaCapabilities.decodingInfo = async (configuration) => {
        const codec = configuration?.video?.codec || "";
        if (isBlocked(codec)) {
          return { supported: false, smooth: false, powerEfficient: false };
        }
        return originalDecodingInfo(configuration);
      };
    }
  } catch {
    /* Never break the embed because of a guard failure. */
  }
})();
