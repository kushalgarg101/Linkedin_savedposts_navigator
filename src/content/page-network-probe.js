(() => {
  const EVENT_NAME = "LSN_API_CANDIDATE";
  const seen = new Set();

  function isLinkedInApiUrl(url) {
    try {
      const parsed = new URL(String(url || ""), window.location.origin);
      if (parsed.protocol !== "https:") return false;
      const host = parsed.hostname.toLowerCase();
      if (host !== "www.linkedin.com" && host !== "linkedin.com") return false;
      const path = parsed.pathname.toLowerCase();
      return path.includes("/voyager/api/") || path.includes("/voyager/graphql") || path.includes("/graphql");
    } catch {
      return false;
    }
  }

  function emit(url, source) {
    const normalized = String(url || "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    try {
      window.dispatchEvent(
        new CustomEvent(EVENT_NAME, {
          detail: {
            url: normalized,
            source: String(source || ""),
            ts: Date.now(),
          },
        }),
      );
    } catch {
      // ignore dispatch failures
    }
  }

  try {
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function patchedFetch(input, init) {
        try {
          const candidate = typeof input === "string" ? input : String(input?.url || input || "");
          // Skip invalid URLs (like chrome-extension://)
          if (candidate && !candidate.startsWith("chrome-extension://")) {
            if (isLinkedInApiUrl(candidate)) emit(candidate, "fetch");
          }
        } catch {
          // ignore
        }
        // Call original fetch without 'this' binding to avoid context issues
        return originalFetch(input, init);
      };
    }
  } catch {
    // ignore
  }

  try {
    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const originalOpen = XHR.prototype.open;
      XHR.prototype.open = function patchedOpen(method, url, ...rest) {
        try {
          const urlStr = String(url || "");
          // Skip invalid URLs
          if (urlStr && !urlStr.startsWith("chrome-extension://")) {
            if (isLinkedInApiUrl(urlStr)) emit(urlStr, "xhr");
          }
        } catch {
          // ignore
        }
        return originalOpen.apply(this, [method, url, ...rest]);
      };
    }
  } catch {
    // ignore
  }
})();
