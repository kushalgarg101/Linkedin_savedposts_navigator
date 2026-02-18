if (window.__LSN_LOADED__) {
  console.log("[LSN] Already loaded, skipping");
} else {
  window.__LSN_LOADED__ = true;

  const MESSAGE_TYPES = Object.freeze({
    SYNC_STATUS: "SYNC_STATUS",
    SYNC_PROGRESS: "SYNC_PROGRESS",
    INDEX_BATCH: "INDEX_BATCH",
    START_FULL_SYNC: "START_FULL_SYNC",
    RESTART_FULL_SYNC: "RESTART_FULL_SYNC",
    RUN_INCREMENTAL_CHECK: "RUN_INCREMENTAL_CHECK",
    SEARCH_QUERY: "SEARCH_QUERY",
    AUTHOR_SUGGESTIONS: "AUTHOR_SUGGESTIONS",
    OPEN_POST: "OPEN_POST",
    OPEN_ATTACHMENT: "OPEN_ATTACHMENT",
    OPEN_PROFILE: "OPEN_PROFILE",
  });

  const CARD_SELECTORS = [
    ".scaffold-finite-scroll__content > div",
    "[data-test-id*='saved']",
    ".entity-result",
    ".reusable-search__result-container",
    "li",
  ];

  const LINK_SELECTORS = [
    "a[href*='/feed/update/']",
    "a[href*='/posts/']",
  ];

  const AUTHOR_SELECTORS = [
    ".entity-result__content-actor span[dir='ltr'] > span[aria-hidden='true']",
    ".entity-result__content-actor span[dir='ltr']",
    ".entity-result__content-actor a[href*='/in/'] span[aria-hidden='true']",
    ".entity-result__content-actor a[href*='/in/']",
    ".update-components-actor__title a span[dir='ltr']",
    ".update-components-actor__title span[dir='ltr']",
    ".update-components-actor__title a",
    ".update-components-actor__title",
    ".update-components-actor__name",
    ".entity-result__title-text",
    "a[href*='/in/'] span[aria-hidden='true']",
    "a[href*='/in/']",
    "h3",
  ];

  const DATE_SELECTORS = [
    "time",
    ".entity-result__content-actor p.t-black--light span[aria-hidden='true']",
    ".entity-result__content-actor .t-black--light span[aria-hidden='true']",
    ".entity-result__content-actor p.t-black--light",
    ".update-components-actor__sub-description",
    ".entity-result__primary-subtitle",
  ];

  const TEXT_SELECTORS = [
    ".entity-result__content-summary",
    ".entity-result__content-summary--3-lines",
    ".update-components-text",
    ".feed-shared-update-v2__description",
    ".entity-result__summary",
    ".feed-shared-update-v2__commentary",
    ".break-words",
    "[data-test-id*='main-feed-activity-card']",
    "span[dir='ltr']",
  ];

  const SEE_MORE_SELECTORS = [
    "button.update-components-text-view__see-more-link",
    "button[data-control-name*='see_more']",
    "button[aria-label*='see more' i]",
    "button[aria-expanded='false']",
    "[role='button'][aria-label*='see more' i]",
    "span[role='button']",
  ];

  const POLL_MS = 1500;
  const DEFAULT_PAGE_SIZE = 50;
  const ALL_MATCHES_PAGE_SIZE = 200;
  const RESIZE_WIDTH_STORAGE_KEY = "lsn.sidebarWidthPx";
  const RESIZE_HEIGHT_STORAGE_KEY = "lsn.sidebarHeightPx";
  const PANEL_DEFAULT_WIDTH = 420;
  const PANEL_MIN_WIDTH = 320;
  const PANEL_MAX_VIEWPORT_FACTOR = 0.85;
  const PANEL_DEFAULT_HEIGHT = 760;
  const PANEL_MIN_HEIGHT = 360;
  const PANEL_MAX_HEIGHT_VIEWPORT_FACTOR = 0.9;
  const QUICK_CHECK_PAGE_LIMIT = 3;
  const FULL_SYNC_PAGE_LIMIT = 300;
  const PAGE_DELAY_MS = 250;
  const PAGE_FETCH_RETRIES = 2;
  const PAGE_FETCH_RETRY_DELAY_MS = 500;
  const DOM_CLICK_FALLBACK_MAX_STEPS = 180;
  const DOM_CLICK_FALLBACK_WAIT_MS = 1600;
  const DOM_CLICK_FALLBACK_IDLE_STEPS = 4;
  const HTML_FALLBACK_PAGE_SIZE = 10;
  const HTML_FALLBACK_MAX_PAGES = 200;
  const HTML_FALLBACK_VARIANT_LIMIT = 5;
  const CONSECUTIVE_EMPTY_PAGES_LIMIT = 3;
  const SIDEBAR_BIND_VERSION = "2";
  const DEBUG_SYNC_STORAGE_KEY = "lsn.debug.sync";
  const DEBUG_SYNC_LOG_STORAGE_KEY = "lsn.debug.sync.buffer";
  const SYNC_DEBUG_LOG_LIMIT = 1200;

  const searchState = {
    page: 1,
    totalPages: 1,
  };
  let runtimeInvalidated = false;
  let statusPollTimer = null;
  let sidebarMountObserver = null;
  let sidebarEnsureTimer = null;
  let sidebarBootstrapRetryTimer = null;
  let syncInProgress = false;
  let sidebarWidthPx = PANEL_DEFAULT_WIDTH;
  let sidebarHeightPx = PANEL_DEFAULT_HEIGHT;
  let currentSyncMode = "idle";
  let pendingSyncRequest = null;
  const runtimeApiCandidates = new Set();
let pageProbeInstalled = false;

const searchSuggestionsState = {
  items: [],
  open: false,
  highlight: -1,
};

function isSyncDebugEnabled() {
    return true; // Force enabled for verification phase
  }

  function toDebugNodeSummary(node) {
    if (!(node instanceof HTMLElement)) return "";
    const tag = String(node.tagName || "").toLowerCase();
    const id = node.id ? `#${node.id}` : "";
    const cls = String(node.className || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((x) => `.${x}`)
      .join("");
    const label = normalizeWhitespace(node.getAttribute("aria-label") || node.textContent || "").slice(0, 80);
    return `${tag}${id}${cls} "${label}"`;
  }

  function debugSync(event, payload = {}) {
    // Always log to console for debugging
    console.log(`[LSN Debug] ${event}:`, payload);

    if (!isSyncDebugEnabled()) return;
    try {
      const bucket = Array.isArray(window.__LSN_DEBUG_EVENTS__) ? window.__LSN_DEBUG_EVENTS__ : [];
      bucket.push({
        ts: new Date().toISOString(),
        event: String(event || ""),
        payload,
      });
      if (bucket.length > SYNC_DEBUG_LOG_LIMIT) {
        bucket.splice(0, bucket.length - SYNC_DEBUG_LOG_LIMIT);
      }
      window.__LSN_DEBUG_EVENTS__ = bucket;
      try {
        const serialized = bucket
          .map((row) => {
            let body = "{}";
            try {
              body = JSON.stringify(row?.payload ?? {});
            } catch {
              body = "{\"error\":\"payload-not-serializable\"}";
            }
            return `${String(row?.ts || "")} ${String(row?.event || "")} ${body}`;
          })
          .join("\n");
        window.localStorage?.setItem(DEBUG_SYNC_LOG_STORAGE_KEY, serialized);
        mirrorDebugBufferToDom(serialized);
      } catch {
        // ignore storage write failures
      }
      console.info(`[LSN][debug] ${event}`, payload);
    } catch {
      // non-fatal
    }
  }

  function mirrorDebugBufferToDom(serialized) {
    try {
      let node = document.getElementById("lsn-debug-sync-buffer");
      if (!(node instanceof HTMLTextAreaElement)) {
        node = document.createElement("textarea");
        node.id = "lsn-debug-sync-buffer";
        node.setAttribute("aria-hidden", "true");
        node.tabIndex = -1;
        node.style.position = "fixed";
        node.style.left = "10px";
        node.style.top = "10px";
        node.style.width = "400px";
        node.style.height = "200px";
        node.style.opacity = "0.01"; // Nearly invisible but exists in layout
        node.style.zIndex = "-1";
        node.style.pointerEvents = "none";
        (document.body || document.documentElement)?.appendChild(node);
      }
      node.value = String(serialized || "");
    } catch {
      // ignore DOM mirror errors
    }
  }

  function installDebugHelpers() {
    try {
      if (!Array.isArray(window.__LSN_DEBUG_EVENTS__)) {
        window.__LSN_DEBUG_EVENTS__ = [];
      }

      // Debug function to get logs
      window.__LSN_GET_DEBUG_SYNC__ = function () {
        const events = Array.isArray(window.__LSN_DEBUG_EVENTS__) ? window.__LSN_DEBUG_EVENTS__ : [];
        return events
          .map((row) => {
            const ts = String(row?.ts || "");
            const event = String(row?.event || "");
            let payload = "";
            try {
              payload = JSON.stringify(row?.payload ?? {});
            } catch {
              payload = "{\"error\":\"payload-not-serializable\"}";
            }
            return `${ts} ${event} ${payload}`;
          })
          .join("\n");
      };

      // Clear function
      window.__LSN_CLEAR_DEBUG_SYNC__ = function () {
        window.__LSN_DEBUG_EVENTS__ = [];
        return true;
      };

      // Simple log function for immediate use
      window.__LSN_LOG__ = function (event, payload) {
        if (!Array.isArray(window.__LSN_DEBUG_EVENTS__)) {
          window.__LSN_DEBUG_EVENTS__ = [];
        }
        window.__LSN_DEBUG_EVENTS__.push({
          ts: new Date().toISOString(),
          event: String(event),
          payload: payload ?? {}
        });
        // Also log to console for immediate visibility
        console.log(`[LSN] ${event}:`, payload);
      };

      console.log("[LSN] Debug helpers installed successfully");
      console.log("[LSN] Available functions:");
      console.log("  - window.__LSN_GET_DEBUG_SYNC__()");
      console.log("  - window.__LSN_CLEAR_DEBUG_SYNC__()");
      console.log("  - window.__LSN_LOG__(event, payload)");
    } catch {
      // non-fatal
    }
  }

  // Install debug helpers immediately so they are available even before full bootstrap.
  installDebugHelpers();

  function installPageApiProbe() {
    if (pageProbeInstalled) return;
    pageProbeInstalled = true;

    window.addEventListener("LSN_API_CANDIDATE", (event) => {
      const detail = event?.detail || {};
      const url = String(detail?.url || "");
      if (!url || !isLinkedInApiCandidateUrl(url)) return;
      runtimeApiCandidates.add(url);
      debugSync("probe-candidate", {
        url,
        source: String(detail?.source || ""),
        totalRuntimeCandidates: runtimeApiCandidates.size,
      });
    });

    try {
      const probeId = "lsn-page-network-probe";
      if (document.getElementById(probeId)) return;
      const script = document.createElement("script");
      script.id = probeId;
      script.src = chrome.runtime.getURL("src/content/page-network-probe.js");
      script.async = false;
      script.onload = () => {
        script.remove();
        debugSync("probe-installed", { ok: true });
      };
      script.onerror = () => {
        debugSync("probe-installed", { ok: false, error: "script load failed" });
        script.remove();
      };
      (document.head || document.documentElement || document.body)?.appendChild(script);
    } catch (error) {
      debugSync("probe-installed", { ok: false, error: String(error?.message || error) });
    }
  }

  function logError(context, error) {
    const detail = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error);
    console.error(`[LSN] ${context}: ${detail}`);
  }

  function isRuntimeInvalidationError(error) {
    const message = String(error?.message || error || "").toLowerCase();
    return message.includes("extension context invalidated");
  }

  function isRecoverableMessageChannelError(error) {
    const message = String(error?.message || error || "").toLowerCase();
    return (
      message.includes("receiving end does not exist") ||
      message.includes("the message port closed before a response was received") ||
      message.includes("could not establish connection")
    );
  }

  function showRuntimeInvalidationNotice() {
    const node = document.getElementById("lsn-runtime-notice");
    if (!node) return;
    node.textContent = "Extension reloaded. Refresh this LinkedIn tab to continue.";
    node.style.display = "block";
  }

  function handleRuntimeInvalidation(error) {
    if (runtimeInvalidated) return;
    runtimeInvalidated = true;
    logError("runtime invalidated", error);
    showRuntimeInvalidationNotice();
    if (statusPollTimer) {
      clearTimeout(statusPollTimer);
      statusPollTimer = null;
    }
    syncInProgress = false;
  }

  function hashString(input) {
    let h = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      h ^= input.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(16);
  }

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function classifyContentType(text) {
    return "post";
  }

  function classifyAttachmentType(entityResult, strings) {
    if (!entityResult) {
      // Check strings for external links
      if (strings?.some(s => s.includes('youtube.com') || s.includes('youtu.be') || s.includes('vimeo.com'))) return "video";
      if (strings?.some(s => s.includes('/pulse/') || s.includes('/news/'))) return "article";
      if (strings?.some(s => s.includes('/docs/') || s.includes('.pdf'))) return "document";
      return "post";
    }

    // Check entityEmbeddedObject (most reliable)
    const embedded = entityResult?.entityEmbeddedObject;
    if (embedded?.article) return "article";

    if (embedded?.image?.attributes?.length > 0) {
      const accText = String(embedded.image.accessibilityText || "").toLowerCase();
      if (accText.includes("video")) return "video";
      return "image";
    }

    // Check template
    const template = entityResult?.template || "";
    if (template.includes('DOCUMENT')) return "document";
    if (template.includes('ARTICLE')) return "article";

    // Check strings for external links
    if (strings?.some(s => s.includes('youtube.com') || s.includes('youtu.be') || s.includes('vimeo.com'))) return "video";
    if (strings?.some(s => s.includes('/pulse/') || s.includes('/news/'))) return "article";
    if (strings?.some(s => s.includes('/docs/') || s.includes('.pdf'))) return "document";

    return "post";
  }

  function inferContentTypeFromCard(card, text = "") {
    const byText = classifyContentType(text);
    if (byText !== "unknown") return byText;

    if (card.querySelector("[data-test-icon*='play' i], [aria-label*='video' i], [aria-label*='watch' i]")) {
      return "video";
    }
    if (
      card.querySelector(
        "[data-test-icon*='document' i], [aria-label*='document' i], [aria-label*='pdf' i], a[href*='/docs/']",
      )
    ) {
      return "document";
    }
    if (card.querySelector("a[href*='/pulse/'], a[href*='/news/']")) {
      return "article";
    }
    return "unknown";
  }

  function addMonths(date, months) {
    const d = new Date(date.getTime());
    d.setMonth(d.getMonth() + months);
    return d;
  }

  function parseRelativeDateLoose(value) {
    const raw = normalizeWhitespace(value || "").toLowerCase();
    if (!raw) return null;
    const match = raw.match(/\b(\d+)\s*(m|mo|w|d|h|hr|y|yr)\b/);
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const now = new Date();
    let dt = new Date(now.getTime());

    if (unit === "m") {
      dt = new Date(now.getTime() - amount * 60 * 1000);
    } else if (unit === "h" || unit === "hr") {
      dt = new Date(now.getTime() - amount * 60 * 60 * 1000);
    } else if (unit === "d") {
      dt = new Date(now.getTime() - amount * 24 * 60 * 60 * 1000);
    } else if (unit === "w") {
      dt = new Date(now.getTime() - amount * 7 * 24 * 60 * 60 * 1000);
    } else if (unit === "mo") {
      dt = addMonths(now, -amount);
    } else if (unit === "y" || unit === "yr") {
      dt = addMonths(now, -amount * 12);
    } else {
      return null;
    }
    return dt.toISOString();
  }

  function parseDateLoose(value) {
    if (!value) return null;
    const relative = parseRelativeDateLoose(value);
    if (relative) return relative;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed).toISOString();
  }

  function normalizeSavedPost(raw) {
    const postUrl = normalizeWhitespace(raw?.postUrl || "");
    const authorName = normalizeWhitespace(raw?.authorName || "");
    const contentText = normalizeWhitespace(raw?.contentText || "");
    const dateLabel = normalizeWhitespace(raw?.dateLabel || "");
    const postDate = parseDateLoose(raw?.postDate || dateLabel);
    const attachmentUrl = normalizeWhitespace(raw?.attachmentUrl || "");
    const attachmentTitle = normalizeWhitespace(raw?.attachmentTitle || "");
    const attachmentType = normalizeWhitespace(raw?.attachmentType || "");
    const attachmentPreviewUrl = normalizeWhitespace(raw?.attachmentPreviewUrl || "");
    const idBase = postUrl || [authorName, contentText.slice(0, 120), postDate || dateLabel].join("|");
    const id = `lsn_${hashString(idBase)}`;

    return {
      id,
      postUrl,
      authorName,
      contentText,
      contentType: normalizeWhitespace(raw?.contentType || "") || classifyContentType(contentText),
      dateLabel,
      postDate,
      attachmentUrl,
      attachmentTitle,
      attachmentType,
      attachmentPreviewUrl,
      savedAt: null,
      indexedAt: new Date().toISOString(),
      rawMeta: { source: "linkedin_saved_posts" },
      miniProfileUrn: raw?.miniProfileUrn || null,
      profileUrl: raw?.profileUrl || null,
    };
  }

  function stripProfileHeaderNoise(contentText) {
    const text = normalizeWhitespace(contentText || "");
    let cleaned = text
      .replace(/^.{2,80}?\s*View\s+.+?\s+profile\s*/i, "")
      .replace(/^•\s*\d+(?:st|nd|rd|th)\s*•\s*\d+(?:st|nd|rd|th)\s*/i, "")
      .replace(/^•\s*\d+(?:st|nd|rd|th)\s*/i, "")
      .replace(/\bVisible to everyone\b/gi, " ")
      .replace(/\bLike\b|\bComment\b|\bRepost\b|\bSend\b|\bShare\b/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    cleaned = cleaned
      .replace(
        /^.{0,240}?\b\d+\s*(?:mo|w|d|h|hr|m|yr|y)\b\s*•\s*\d+\s*(?:mo|w|d|h|hr|m|yr|y)\b\s*/i,
        "",
      )
      .replace(/^.{0,220}?\b\d+\s*(?:mo|w|d|h|hr|m|yr|y)\b\s*•\s*/i, "")
      .replace(/^.{0,220}?\b(?:follow|message|connect)\b\s*/i, "")
      .trim();

    return cleaned || text;
  }

  function isInvalidAuthorText(text) {
    const normalized = normalizeWhitespace(text || "").toLowerCase();
    if (!normalized) return true;
    if (normalized.length < 3 || normalized.length > 80) return true;
    if (/^(status is offline|offline|view profile|profile|follow|message|connect)$/i.test(normalized)) return true;
    if (/visible to everyone/i.test(normalized)) return true;
    if (/\b(status|offline|follower|followers|connection|connections)\b/i.test(normalized)) return true;
    if (/[<>/]/.test(normalized)) return true;
    return false;
  }

  function looksLikePersonName(text) {
    const candidate = normalizeWhitespace(text || "");
    if (!candidate || candidate.length < 3 || candidate.length > 80) return false;
    if (candidate.includes("|") || candidate.includes(":") || candidate.includes("@")) return false;
    if (/\d/.test(candidate)) return false;
    if (/\b(author|engineer|research|founder|professor|student|creator|lead|head|manager)\b/i.test(candidate)) {
      return false;
    }
    const words = candidate.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 6) return false;
    return words.every((word) => /^[\p{L}\p{M}][\p{L}\p{M}.'-]*$/u.test(word));
  }

  function scoreAuthorCandidate(text) {
    const candidate = normalizeWhitespace(text || "");
    if (isInvalidAuthorText(candidate)) return -1;
    if (!looksLikePersonName(candidate)) return -1;
    const words = candidate.split(/\s+/).filter(Boolean);
    let score = 0;
    if (words.length >= 2 && words.length <= 5) score += 3;
    if (/^[\p{L}\p{M}][\p{L}\p{M}.'-]*(?:\s+[\p{L}\p{M}][\p{L}\p{M}.'-]*)+$/u.test(candidate)) score += 3;
    if (/[A-Z\p{Lu}]/u.test(candidate)) score += 1;
    if (/\d/.test(candidate)) score -= 2;
    return score;
  }

  function pickBestAuthor(candidates) {
    for (const c of candidates) {
      let val = normalizeWhitespace(c);
      if (!val) continue;

      // Remove common non-name noise
      val = val.replace(/View\s+.*'s\s+profile/gi, "");
      val = val.replace(/View\s+.*’s\s+profile/gi, "");
      val = val.replace(/View\sprofile/gi, "");
      val = val.replace(/•\s+\w+\s+/g, ""); // Remove separators
      val = val.trim();

      if (val && val.length > 2 && val.length < 100 && !val.includes("/")) {
        return val;
      }
    }
    return "Unknown author";
  }

  function toTitleCaseName(text) {
    return String(text || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }

  function extractAuthorFromProfileSlug(href) {
    try {
      const parsed = new URL(href, window.location.origin);
      const path = parsed.pathname || "";
      const match = path.match(/\/in\/([^/?#]+)/i);
      if (!match?.[1]) return "";
      const slug = match[1]
        .replace(/[-_]+/g, " ")
        .replace(/\b\d+\b/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (!slug) return "";
      const normalized = toTitleCaseName(slug);
      return looksLikePersonName(normalized) ? normalized : "";
    } catch {
      return "";
    }
  }

  function extractAuthorFromProfileLinks(card) {
    // LinkedIn randomization often puts the name inside an <a> with /in/
    const profileLinks = Array.from(card.querySelectorAll("a[href*='/in/'], a[href*='/company/']"));
    for (const link of profileLinks) {
      const text = normalizeWhitespace(link.textContent);
      // Names usually don't have too many words and aren't "View profile"
      if (text && text.length > 1 && text.length < 80 && !/view\s+profile/i.test(text)) {
        return text;
      }
      const span = link.querySelector("span[aria-hidden='true']");
      if (span) {
        const spanText = normalizeWhitespace(span.textContent);
        if (spanText && spanText.length > 1 && spanText.length < 80) return spanText;
      }
    }
    return "";
  }

  function extractPostLinkText(card) {
    const postLink = card.querySelector("a[href*='/feed/update/'], a[href*='/posts/']");
    if (!postLink) return "";
    const bits = [
      postLink.textContent || "",
      postLink.getAttribute("aria-label") || "",
      postLink.getAttribute("title") || "",
    ]
      .map((x) => normalizeWhitespace(x))
      .filter(Boolean);
    return bits.join(" ");
  }

  function looksLikeProfileBlurb(text) {
    const t = normalizeWhitespace(text || "");
    if (!t) return true;
    if (/\b(view\s+profile|connections?|followers?|visible to everyone)\b/i.test(t)) return true;
    if (
      /^\s*[^.!?]{8,220}\b\d+\s*(?:mo|w|d|h|hr|m|yr|y)\b\s*•\s*\d+\s*(?:mo|w|d|h|hr|m|yr|y)\b/i.test(t)
    ) {
      return true;
    }
    if (/\|/.test(t) && /\b(head|founder|creator|educator|evangelist|podcast|manager|lead|engineer)\b/i.test(t)) {
      return true;
    }
    return false;
  }

  function extractBestContentText(card) {
    const selectorCandidates = [];
    for (const selector of TEXT_SELECTORS) {
      const node = card.querySelector(selector);
      if (!node) continue;
      const text = normalizeWhitespace(node.textContent || "");
      if (text) selectorCandidates.push(text);
    }

    const candidates = [];
    for (const text of selectorCandidates) {
      candidates.push({ text, source: "selector" });
    }

    const postLinkText = extractPostLinkText(card);
    if (postLinkText) candidates.push({ text: postLinkText, source: "post-link" });

    const cardText = normalizeWhitespace(card.textContent || "");
    if (cardText) candidates.push({ text: cardText, source: "card" });

    const cleaned = candidates
      .map((entry) => ({
        source: entry.source,
        text: normalizeWhitespace(stripProfileHeaderNoise(entry.text)),
      }))
      .filter(Boolean)
      .filter((entry) => entry.text.length >= 8)
      .filter((entry) => !looksLikeProfileBlurb(entry.text) || entry.source !== "selector");

    if (cleaned.length === 0) {
      return "";
    }

    const scored = cleaned.map((entry) => {
      let score = Math.min(entry.text.length, 280);
      if (entry.source === "selector") score += 40;
      if (entry.source === "post-link") score += 10;
      if (entry.source === "card") score -= 30;
      if (looksLikeProfileBlurb(entry.text)) score -= 80;
      if (/\b(view|profile|follower|followers|connections?)\b/i.test(entry.text)) score -= 30;
      return { ...entry, score };
    });

    scored.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
    return scored[0].text;
  }

  function isSeeMoreControl(node) {
    if (!node) return false;
    const text = normalizeWhitespace(node.textContent || node.getAttribute?.("aria-label") || "").toLowerCase();
    if (!text) return false;
    if (text.includes("see more")) return true;
    if (text.includes("...see more")) return true;
    if (text.includes("…see more")) return true;
    if (text === "more") return true;
    return false;
  }

  function expandCardTruncatedText(card) {
    const candidates = [];
    for (const selector of SEE_MORE_SELECTORS) {
      const matches = card.querySelectorAll(selector);
      if (matches?.length) {
        candidates.push(...Array.from(matches));
      }
    }

    const seen = new Set();
    for (const node of candidates) {
      if (!(node instanceof HTMLElement)) continue;
      if (seen.has(node)) continue;
      seen.add(node);
      if (!isSeeMoreControl(node)) continue;
      if (node.dataset?.lsnExpanded === "1") continue;
      if (node.offsetParent === null) continue;
      try {
        node.click();
        node.dataset.lsnExpanded = "1";
      } catch {
        // ignore transient click failures on dynamic LinkedIn controls
      }
    }
  }

  function textFromSelectors(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node?.textContent?.trim()) {
        return node.textContent.trim();
      }
    }
    return "";
  }

  function linkFromSelectors(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node?.href) {
        return node.href;
      }
    }
    return "";
  }

  function canonicalizePostUrl(url) {
    if (!url) return "";
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.protocol !== "https:") return "";
      if (parsed.hostname !== "www.linkedin.com" && parsed.hostname !== "linkedin.com") return "";
      if (!parsed.pathname.includes("/feed/update/") && !parsed.pathname.includes("/posts/")) return "";
      parsed.search = "";
      parsed.hash = "";
      let result = parsed.toString();
      // Normalize trailing slashes
      if (result.endsWith('/')) {
        result = result.slice(0, -1);
      }
      return result;
    } catch {
      return "";
    }
  }

  function canonicalizeAttachmentUrl(url) {
    if (!url) return "";
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.protocol !== "https:") return "";
      // Exclude LinkedIn internal URLs (profiles, posts, feeds)
      if (parsed.hostname.includes("linkedin.com")) {
        // Only allow external content URLs like /pulse/ or /docs/
        if (!parsed.pathname.includes("/pulse/") && !parsed.pathname.includes("/docs/")) {
          return "";
        }
      }
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return "";
    }
  }

  function extractFirstUrl(text) {
    const value = String(text || "");
    const match = value.match(/https?:\/\/[^\s<>"')]+/i);
    return canonicalizeAttachmentUrl(match?.[0] || "");
  }

  function extractAttachmentFromCard(card, postUrl, contentText, fallbackType = "unknown") {
    const anchorCandidates = Array.from(card.querySelectorAll("a[href]"));
    let attachmentUrl = "";
    let attachmentTitle = "";

    for (const anchor of anchorCandidates) {
      const href = canonicalizeAttachmentUrl(anchor.getAttribute("href") || anchor.href || "");
      if (!href) continue;
      if (href === postUrl) continue;
      if (/\/in\//i.test(href)) continue;
      if (/\/my-items\/saved-posts/i.test(href)) continue;
      attachmentUrl = href;
      attachmentTitle = normalizeWhitespace(anchor.textContent || anchor.getAttribute("aria-label") || "");
      break;
    }

    if (!attachmentUrl) {
      const textUrl = extractFirstUrl(contentText);
      if (textUrl && textUrl !== postUrl) {
        attachmentUrl = textUrl;
      }
    }

    const previewImage = card.querySelector("img.entity-result__embedded-object-image, img[alt*='Image preview' i]");
    const previewUrl = canonicalizeAttachmentUrl(previewImage?.getAttribute("src") || "");
    if (!attachmentUrl && previewUrl) {
      attachmentUrl = previewUrl;
    }

    const titleAndText = `${attachmentTitle} ${contentText}`.toLowerCase();
    let inferredType = fallbackType;
    if (
      /\b(book|guide|pdf|paper|whitepaper|ebook|e-book|manual|chapter|textbook|read)\b/i.test(titleAndText) ||
      /\.pdf(\b|$)/i.test(attachmentUrl)
    ) {
      inferredType = "document";
    } else if (/\b(video|watch|youtube|webinar|livestream|podcast episode)\b/i.test(titleAndText)) {
      inferredType = "video";
    } else if (fallbackType === "unknown" && previewUrl) {
      inferredType = "unknown";
    }
    return {
      attachmentUrl,
      attachmentTitle,
      attachmentType: inferredType,
      attachmentPreviewUrl: previewUrl,
    };
  }

  function queryCards() {
    let best = [];
    for (const selector of CARD_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      if (nodes.length > best.length) {
        best = Array.from(nodes);
      }
    }
    return best;
  }

  function extractVisibleBatch(seenIds) {
    const cards = queryCards();
    const items = [];
    for (const card of cards) {
      expandCardTruncatedText(card);
      const postUrl = canonicalizePostUrl(linkFromSelectors(card, LINK_SELECTORS));

      // Improved author discovery for DOM
      const authorNameFromSelectors = textFromSelectors(card, AUTHOR_SELECTORS);
      const profileLinkAuthor = extractAuthorFromProfileLinks(card);
      const bestAuthor = pickBestAuthor([authorNameFromSelectors, profileLinkAuthor]);

      const dateLabel = textFromSelectors(card, DATE_SELECTORS);
      const rawText = extractBestContentText(card);
      const contentText = stripProfileHeaderNoise(rawText);
      const contentType = inferContentTypeFromCard(card, contentText);

      if (!postUrl) {
        continue;
      }

      const attachmentSizeFallback = attachmentSize(card);
      const attachment = extractAttachmentFromCard(card, postUrl, contentText, contentType);
      const mergedType =
        attachment.attachmentType &&
          attachment.attachmentType !== "unknown" &&
          (contentType === "unknown" || contentType === "image" || contentType === "video")
          ? attachment.attachmentType
          : contentType;

      const normalized = normalizeSavedPost({
        postUrl,
        authorName: bestAuthor,
        dateLabel,
        contentText,
        contentType: mergedType,
        attachmentUrl: attachment.attachmentUrl,
        attachmentTitle: attachment.attachmentTitle,
        attachmentType: attachment.attachmentType,
        attachmentPreviewUrl: attachment.attachmentPreviewUrl,
      });

      if (seenIds.has(normalized.id)) {
        continue;
      }
      seenIds.add(normalized.id);
      items.push(normalized);
    }
    return items;
  }

  function collectPostUrlsFromDocument(doc) {
    const cards = [];
    for (const selector of CARD_SELECTORS) {
      const nodes = doc.querySelectorAll(selector);
      if (nodes.length > cards.length) {
        cards.splice(0, cards.length, ...Array.from(nodes));
      }
    }
    const urls = [];
    for (const card of cards) {
      const postUrl = canonicalizePostUrl(linkFromSelectors(card, LINK_SELECTORS));
      if (postUrl) urls.push(postUrl);
    }
    return Array.from(new Set(urls));
  }

  function collectPostUrlsFromHtmlRaw(html) {
    const text = String(html || "");
    if (!text) return [];
    const decoded = text.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
    const matches = decoded.match(/https:\/\/(?:www\.)?linkedin\.com\/(?:feed\/update\/|posts\/)[^"'<\s\\]+/gi) || [];
    return Array.from(new Set(matches.map((u) => canonicalizePostUrl(u)).filter(Boolean)));
  }

  function buildBatchFromUrls(urls, seenIds) {
    const items = [];
    for (const postUrl of urls) {
      const normalized = normalizeSavedPost({
        postUrl,
        authorName: "",
        dateLabel: "",
        contentText: "",
        contentType: "unknown",
      });
      if (seenIds.has(normalized.id)) continue;
      seenIds.add(normalized.id);
      items.push(normalized);
    }
    return items;
  }

  async function fetchSavedPostsHtmlPage(start) {
    const url = new URL(window.location.href);
    url.searchParams.set("start", String(Math.max(0, Number(start) || 0)));
    const response = await fetch(url.toString(), {
      method: "GET",
      credentials: "include",
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) {
      throw new Error(`HTML fallback HTTP ${response.status}`);
    }
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return { doc, html, htmlLength: html.length, url: url.toString() };
  }

  function buildHtmlPaginationVariants(pageIndex, start) {
    const offset = Math.max(0, Number(start) || 0);
    const pageNum = Math.max(1, Number(pageIndex || 0) + 1);
    const base = new URL(window.location.href);
    const variants = [];

    const addVariant = (mutate) => {
      const u = new URL(base.toString());
      mutate(u);
      variants.push(u.toString());
    };

    addVariant((u) => {
      u.searchParams.set("start", String(offset));
      u.searchParams.delete("page");
      u.searchParams.delete("offset");
    });
    addVariant((u) => {
      u.searchParams.set("start", String(offset));
      u.searchParams.set("count", String(HTML_FALLBACK_PAGE_SIZE));
      u.searchParams.delete("page");
      u.searchParams.delete("offset");
    });
    addVariant((u) => {
      u.searchParams.set("offset", String(offset));
      u.searchParams.set("count", String(HTML_FALLBACK_PAGE_SIZE));
      u.searchParams.delete("start");
      u.searchParams.delete("page");
    });
    addVariant((u) => {
      u.searchParams.set("page", String(pageNum));
      u.searchParams.delete("start");
      u.searchParams.delete("offset");
    });
    addVariant((u) => {
      u.searchParams.set("page", String(pageNum));
      u.searchParams.set("start", String(offset));
    });

    return Array.from(new Set(variants)).slice(0, HTML_FALLBACK_VARIANT_LIMIT);
  }

  async function fetchSavedPostsHtmlByUrl(url) {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) {
      throw new Error(`HTML fallback HTTP ${response.status}`);
    }
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return { doc, html, htmlLength: html.length, url };
  }

  function extractSavedPostsPaginationUrlsFromHtml(html) {
    const text = String(html || "");
    if (!text) return [];
    const urls = [];
    const hrefMatches = text.match(/href=["']([^"']*\/my-items\/saved-posts[^"']*)["']/gi) || [];
    for (const raw of hrefMatches) {
      const match = raw.match(/href=["']([^"']+)["']/i);
      if (!match?.[1]) continue;
      const href = match[1].replaceAll("&amp;", "&");
      try {
        const absolute = new URL(href, window.location.origin).toString();
        if (!/linkedin\.com\/my-items\/saved-posts/i.test(absolute)) continue;
        if (!/[?&](start|page|offset|count|cursor|paginationToken)=/i.test(absolute)) continue;
        urls.push(absolute);
      } catch {
        // ignore malformed URL
      }
    }
    return Array.from(new Set(urls));
  }

  function extractApiCandidatesFromHtml(html) {
    const text = String(html || "");
    if (!text) return [];
    const normalized = text.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
    const out = new Set();
    const patterns = [
      /https?:\/\/(?:www\.)?linkedin\.com\/voyager\/api\/[^\s"'<>\\]+/gi,
      /https?:\/\/(?:www\.)?linkedin\.com\/voyager\/graphql[^\s"'<>\\]+/gi,
      /\/voyager\/api\/[^\s"'<>\\]+/gi,
      /\/voyager\/graphql[^\s"'<>\\]+/gi,
    ];
    for (const pattern of patterns) {
      const matches = normalized.match(pattern) || [];
      for (const raw of matches) {
        try {
          const absolute = new URL(raw, window.location.origin).toString();
          if (!isLinkedInApiCandidateUrl(absolute)) continue;
          if (isKnownIrrelevantApiUrl(absolute)) continue;
          out.add(absolute);
        } catch {
          // ignore malformed URLs
        }
      }
    }
    return Array.from(out);
  }

  async function runHtmlPaginationFallback({ mode, cursor, seenIds, pagesFetched, newItems }) {
    let totalPages = Number(pagesFetched || 0);
    let totalNew = Number(newItems || 0);
    let reachedEnd = false;
    let emptyStreak = 0;
    const signatures = new Set();
    let previousPageSignature = "";
    const triedVariantUrls = new Set();
    let carriedPaginationUrls = [];
    const baseStart = Math.max(0, Number(cursor) || 0);

    debugSync("html-fallback-start", { mode, cursor: baseStart, pagesFetched: totalPages, newItems: totalNew });

    for (let page = 0; page < HTML_FALLBACK_MAX_PAGES; page += 1) {
      const start = baseStart + page * HTML_FALLBACK_PAGE_SIZE;
      let payload = null;
      let pageUrls = [];
      let pickedVariant = "";
      const variants = Array.from(new Set([...carriedPaginationUrls, ...buildHtmlPaginationVariants(page, start)]))
        .slice(0, 12);
      for (const variantUrl of variants) {
        if (triedVariantUrls.has(variantUrl)) continue;
        triedVariantUrls.add(variantUrl);
        try {
          const attemptPayload = await fetchSavedPostsHtmlByUrl(variantUrl);
          let urls = collectPostUrlsFromDocument(attemptPayload.doc);
          if (urls.length === 0) {
            urls = collectPostUrlsFromHtmlRaw(attemptPayload.html);
          }
          const pageSignature = urls.slice(0, 10).join("|");
          debugSync("html-fallback-variant", {
            page,
            start,
            variantUrl,
            pageItems: urls.length,
            signatureHead: pageSignature.slice(0, 160),
          });
          if (!payload) {
            payload = attemptPayload;
            pageUrls = urls;
            pickedVariant = variantUrl;
          }
          if (urls.length > 0 && pageSignature && pageSignature !== previousPageSignature) {
            payload = attemptPayload;
            pageUrls = urls;
            pickedVariant = variantUrl;
            break;
          }
        } catch (error) {
          debugSync("html-fallback-fetch-error", {
            page,
            start,
            variantUrl,
            error: String(error?.message || error),
          });
        }
      }
      if (!payload) {
        break;
      }
      const batch = buildBatchFromUrls(pageUrls, seenIds);
      const signature = pageUrls.slice(0, 8).join("|");
      previousPageSignature = signature || previousPageSignature;
      carriedPaginationUrls = extractSavedPostsPaginationUrlsFromHtml(payload.html)
        .filter((u) => !triedVariantUrls.has(u))
        .slice(0, 8);
      debugSync("html-fallback-page", {
        page,
        start,
        pageItems: pageUrls.length,
        batch: batch.length,
        htmlLength: payload.htmlLength,
        url: pickedVariant || payload.url,
        carriedPaginationUrls: carriedPaginationUrls.length,
      });
      if (signature && signatures.has(signature)) {
        emptyStreak += 1;
      } else if (signature) {
        signatures.add(signature);
      }

      if (batch.length > 0) {
        totalPages += 1;
        totalNew += batch.length;
        emptyStreak = 0;
        const stateAfterBatch = await pushBatch(batch, {
          atEnd: false,
          mode,
          cursor: start,
          inFlight: true,
          pagesFetched: totalPages,
          newItems: totalNew,
          checkpoint: { templateUrl: "html-fallback", start, updatedAt: Date.now() },
        });
        renderSyncStatus(stateAfterBatch || {});
      } else {
        emptyStreak += 1;
      }

      if (pageUrls.length > 0 && pageUrls.length < HTML_FALLBACK_PAGE_SIZE) {
        reachedEnd = true;
        break;
      }
      if (pageUrls.length === 0) {
        reachedEnd = true;
        break;
      }
      if (emptyStreak >= 2) {
        break;
      }
    }

    debugSync("html-fallback-end", { mode, reachedEnd, pagesFetched: totalPages, newItems: totalNew });
    return { pagesFetched: totalPages, newItems: totalNew, reachedEnd };
  }

  async function runVisibleSnapshotFallback({ mode, cursor, seenIds, pagesFetched, newItems }) {
    let totalPages = Number(pagesFetched || 0);
    let totalNew = Number(newItems || 0);
    const batch = extractVisibleBatch(seenIds);
    if (batch.length > 0) {
      totalPages += 1;
      totalNew += batch.length;
      const stateAfterBatch = await pushBatch(batch, {
        atEnd: false,
        mode,
        cursor,
        inFlight: true,
        pagesFetched: totalPages,
        newItems: totalNew,
        checkpoint: { templateUrl: "visible-snapshot", start: cursor, updatedAt: Date.now() },
      });
      renderSyncStatus(stateAfterBatch || {});
    }
    return { pagesFetched: totalPages, newItems: totalNew, reachedEnd: false };
  }

  function findLoadMoreControl() {
    const selectors = [
      "button.artdeco-pagination__button--next",
      "a.artdeco-pagination__button--next",
      "a[aria-label*='next' i]",
      "button[data-test-id*='load-more' i]",
      "button[data-test-id*='show-more' i]",
      "button[aria-label*='show more' i]",
      "button[aria-label*='load more' i]",
      "button[aria-label*='next' i]",
      "button[data-control-name*='show_more' i]",
      "button[data-control-name*='pagination_next' i]",
      "[role='button'][aria-label*='show more' i]",
    ];
    const candidates = [];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true") continue;
        if (node.offsetParent === null && node.getClientRects().length === 0) continue;
        const text = normalizeWhitespace(node.textContent || node.getAttribute("aria-label") || "").toLowerCase();
        const cls = String(node.className || "").toLowerCase();
        const score =
          (/(next|show more|load more)/.test(text) ? 3 : 0) +
          (/(pagination|artdeco-pagination)/.test(cls) ? 3 : 0) +
          (node.closest("main") ? 1 : 0);
        candidates.push({ node, score, selector, text: text.slice(0, 80) });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    if (candidates[0]?.node) {
      debugSync("dom-control-picked", {
        totalCandidates: candidates.length,
        pickedSelector: candidates[0].selector,
        pickedScore: candidates[0].score,
        pickedText: candidates[0].text,
        pickedNode: toDebugNodeSummary(candidates[0].node),
      });
      return candidates[0].node;
    }
    debugSync("dom-control-missing", { totalCandidates: 0 });
    return null;
  }

  function hasDisabledNextControl() {
    const selectors = [
      "button.artdeco-pagination__button--next",
      "a.artdeco-pagination__button--next",
      "button[aria-label*='next' i]",
      "a[aria-label*='next' i]",
    ];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.offsetParent === null && node.getClientRects().length === 0) continue;
        if (node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true") {
          return true;
        }
        const cls = String(node.className || "").toLowerCase();
        if (/(disabled|is-disabled)/.test(cls)) return true;
      }
    }
    return false;
  }

  function hasFeedEndMarker() {
    const text = normalizeWhitespace(document.body?.innerText || "").toLowerCase();
    return /you'?ve reached the end|no more results|end of results/.test(text);
  }

  function getCardsSignature() {
    const cards = queryCards();
    const links = cards
      .map((card) => canonicalizePostUrl(linkFromSelectors(card, LINK_SELECTORS)))
      .filter(Boolean);
    const first = links[0] || "";
    const last = links[links.length - 1] || "";
    return `${links.length}|${first}|${last}`;
  }

  async function waitForCardsMutation(previousCount, previousSignature, timeoutMs = DOM_CLICK_FALLBACK_WAIT_MS) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const current = queryCards().length;
      const signature = getCardsSignature();
      if (current !== previousCount || signature !== previousSignature) return true;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return queryCards().length !== previousCount || getCardsSignature() !== previousSignature;
  }

  async function runDomClickPaginationFallback({ mode, cursor, seenIds, pagesFetched, newItems }) {
    let totalPages = Number(pagesFetched || 0);
    let totalNew = Number(newItems || 0);
    let idleSteps = 0;
    let sawControl = false;
    let reachedEnd = false;
    debugSync("dom-fallback-start", { mode, cursor, pagesFetched: totalPages, newItems: totalNew });

    for (let step = 0; step < DOM_CLICK_FALLBACK_MAX_STEPS; step += 1) {
      const batch = extractVisibleBatch(seenIds);
      if (batch.length > 0) {
        totalPages += 1;
        totalNew += batch.length;
        idleSteps = 0;
        const stateAfterBatch = await pushBatch(batch, {
          atEnd: false,
          mode,
          cursor,
          inFlight: true,
          pagesFetched: totalPages,
          newItems: totalNew,
          checkpoint: { templateUrl: "dom-click-fallback", start: cursor, updatedAt: Date.now() },
        });
        renderSyncStatus(stateAfterBatch || {});
        debugSync("dom-fallback-batch", { step, batch: batch.length, pagesFetched: totalPages, newItems: totalNew });
      }

      const beforeCount = queryCards().length;
      const beforeSignature = getCardsSignature();
      const control = findLoadMoreControl();
      if (!control) {
        idleSteps += 1;
        debugSync("dom-fallback-no-control", { step, idleSteps, beforeCount, beforeSignature });
        if (idleSteps >= DOM_CLICK_FALLBACK_IDLE_STEPS) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
        continue;
      }
      sawControl = true;

      try {
        debugSync("dom-fallback-click", { step, control: toDebugNodeSummary(control), beforeCount, beforeSignature });
        control.click();
      } catch {
        idleSteps += 1;
        debugSync("dom-fallback-click-failed", { step, idleSteps });
        continue;
      }

      const changed = await waitForCardsMutation(beforeCount, beforeSignature, DOM_CLICK_FALLBACK_WAIT_MS);
      debugSync("dom-fallback-after-click", {
        step,
        changed,
        afterCount: queryCards().length,
        afterSignature: getCardsSignature(),
      });
      if (changed) {
        idleSteps = 0;
      } else if (batch.length === 0) {
        idleSteps += 1;
        if (idleSteps >= DOM_CLICK_FALLBACK_IDLE_STEPS) {
          break;
        }
      }
    }

    if (sawControl) {
      reachedEnd = hasDisabledNextControl() || hasFeedEndMarker();
    }
    debugSync("dom-fallback-end", {
      mode,
      cursor,
      sawControl,
      reachedEnd,
      endByDisabledControl: hasDisabledNextControl(),
      endByMarker: hasFeedEndMarker(),
      pagesFetched: totalPages,
      newItems: totalNew,
    });
    return { pagesFetched: totalPages, newItems: totalNew, reachedEnd };
  }

  async function sendMessage(type, payload = {}) {
    if (runtimeInvalidated) {
      return {
        ok: false,
        error: "Extension context invalidated. Refresh page.",
        invalidated: true,
      };
    }
    try {
      if (!chrome?.runtime?.id) {
        return {
          ok: false,
          error: "Extension runtime unavailable. Refresh page.",
          invalidated: true,
        };
      }
      return await chrome.runtime.sendMessage({ type, payload });
    } catch (error) {
      if (isRuntimeInvalidationError(error)) {
        handleRuntimeInvalidation(error);
        return {
          ok: false,
          error: "Extension context invalidated. Refresh page.",
          invalidated: true,
        };
      }
      if (isRecoverableMessageChannelError(error)) {
        logError(`sendMessage ${type} transient`, error);
        return {
          ok: false,
          error: "Temporary extension communication issue. Retrying...",
          transient: true,
        };
      }
      logError(`sendMessage ${type}`, error);
      throw error;
    }
  }

  function clampPanelWidth(value) {
    const maxByViewport = Math.max(PANEL_MIN_WIDTH, Math.floor(window.innerWidth * PANEL_MAX_VIEWPORT_FACTOR));
    const numeric = Math.floor(Number(value) || PANEL_DEFAULT_WIDTH);
    return Math.min(maxByViewport, Math.max(PANEL_MIN_WIDTH, numeric));
  }

  function clampPanelHeight(value) {
    const viewport = Math.max(400, Number(window.innerHeight || 0));
    const maxByViewport = Math.max(PANEL_MIN_HEIGHT, Math.floor(viewport * PANEL_MAX_HEIGHT_VIEWPORT_FACTOR));
    const numeric = Math.floor(Number(value) || PANEL_DEFAULT_HEIGHT);
    return Math.min(maxByViewport, Math.max(PANEL_MIN_HEIGHT, numeric));
  }

  async function loadSidebarWidth() {
    try {
      const data = await chrome.storage.local.get([RESIZE_WIDTH_STORAGE_KEY, RESIZE_HEIGHT_STORAGE_KEY]);
      sidebarWidthPx = clampPanelWidth(data?.[RESIZE_WIDTH_STORAGE_KEY] || PANEL_DEFAULT_WIDTH);
      sidebarHeightPx = clampPanelHeight(data?.[RESIZE_HEIGHT_STORAGE_KEY] || PANEL_DEFAULT_HEIGHT);
    } catch {
      sidebarWidthPx = PANEL_DEFAULT_WIDTH;
      sidebarHeightPx = PANEL_DEFAULT_HEIGHT;
    }
  }

  async function saveSidebarWidth(value) {
    const width = clampPanelWidth(value);
    sidebarWidthPx = width;
    try {
      await chrome.storage.local.set({ [RESIZE_WIDTH_STORAGE_KEY]: width });
    } catch {
      // non-fatal
    }
  }

  async function saveSidebarHeight(value) {
    const height = clampPanelHeight(value);
    sidebarHeightPx = height;
    try {
      await chrome.storage.local.set({ [RESIZE_HEIGHT_STORAGE_KEY]: height });
    } catch {
      // non-fatal
    }
  }

  function applySidebarWidth() {
    const root = el("lsn-root");
    if (!root) return;
    root.style.setProperty("--lsn-panel-width", `${clampPanelWidth(sidebarWidthPx)}px`);
    root.style.setProperty("--lsn-panel-height", `${clampPanelHeight(sidebarHeightPx)}px`);
  }

  function extractCsrfToken() {
    const cookie = String(document.cookie || "");
    // Extract JSESSIONID - LinkedIn uses this for CSRF validation
    const match = cookie.match(/(?:^|;\s*)JSESSIONID="?([^";]+)"?/i);
    if (!match?.[1]) return "";
    // The token should be the JSESSIONID value
    return match[1].replace(/"/g, "");
  }

  function isLinkedInApiCandidateUrl(value) {
    try {
      const parsed = new URL(String(value || ""), window.location.origin);
      if (parsed.protocol !== "https:") return false;
      const host = parsed.hostname.toLowerCase();
      if (host !== "www.linkedin.com" && host !== "linkedin.com") return false;
      const href = parsed.toString().toLowerCase();
      if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|map)(\?|$)/i.test(href)) return false;
      if (/\/my-items\/saved-posts\/?$/i.test(parsed.pathname)) return false;
      return /\/(voyager|graphql)\//i.test(parsed.pathname) || /\/voyager\/api\//i.test(href);
    } catch {
      return false;
    }
  }

  function decodeUrlParts(url) {
    try {
      const parsed = new URL(String(url || ""), window.location.origin);
      const raw = `${parsed.pathname} ${parsed.search}`;
      let decoded = raw;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        // keep raw when decode fails
      }
      return decoded.toLowerCase();
    } catch {
      return String(url || "").toLowerCase();
    }
  }

  function isLikelySavedPostsApiUrl(url) {
    const text = decodeUrlParts(url);
    const strongPositive = [
      "saved",
      "saved-posts",
      "my-items",
      "myitems",
      "bookmark",
      "savedposts",
    ];
    const weakPositive = ["entityresult", "start=", "start:", "count=", "count:"];
    const savedIntentSignal =
      text.includes("search_my_items_saved_posts") ||
      text.includes("flagshipsearchintent:search_my_items_saved_posts");
    const negative = [
      "globalalerts",
      "dashmysettings",
      "mysettings",
      "notification",
      "messaging",
      "inbox",
      "ads",
    ];
    const hasStrongPositive = strongPositive.some((token) => text.includes(token));
    const hasWeakPositive = weakPositive.some((token) => text.includes(token));
    const hasNegative = negative.some((token) => text.includes(token));
    return (hasStrongPositive || savedIntentSignal) && !hasNegative && (hasWeakPositive || hasStrongPositive || savedIntentSignal);
  }

  function isKnownIrrelevantApiUrl(url) {
    const text = decodeUrlParts(url);
    const blocked = [
      "globalalerts",
      "dashmysettings",
      "mysettings",
      "thirdpartyidsyncs",
      // searchDashClusters can be valid when carrying SAVED_POSTS intent.
      "organizationdash",
      "mailbox",
      "q=admin",
      "q:admin",
      "premiumdash",
      "featureaccess",
      "away_messages",
      "can_access_away_messages",
      "identitydashprofiles",
      "jobsdash",
      "messaging",
      "notifications",
      "growth",
      "ads",
    ];
    return blocked.some((token) => text.includes(token));
  }

  function scoreApiCandidateUrl(url) {
    const text = decodeUrlParts(url);
    let score = 0;
    if (isKnownIrrelevantApiUrl(url)) return -100;
    if (isLikelySavedPostsApiUrl(url)) score += 8;
    if (/voyagersearchdashclusters/i.test(text)) score += 12;
    if (/search_my_items_saved_posts/i.test(text)) score += 20;
    if (/saved|my-items|myitems|bookmark/.test(text)) score += 6;
    if (/(?:[?&]start=\d+|start:|start%3a)/i.test(url)) score += 4;
    if (/(?:[?&]count=\d+|count:|count%3a)/i.test(url)) score += 3;
    if (/queryid=voyagerfeed|queryid=voyagersearch/i.test(text)) score += 2;
    return score;
  }

  async function runSacrificialScrollDiscovery() {
    try {
      const before = runtimeApiCandidates.size;
      const target = document.scrollingElement || document.documentElement || document.body;
      const maxTop = Math.max(0, Number(target?.scrollHeight || 0) - Number(window.innerHeight || 0));
      window.scrollTo({ top: maxTop, behavior: "auto" });
      await new Promise((resolve) => setTimeout(resolve, 180));
      window.scrollTo({ top: 0, behavior: "auto" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const after = runtimeApiCandidates.size;
      debugSync("sacrificial-scroll", { beforeCandidates: before, afterCandidates: after, gained: after - before });
    } catch (error) {
      debugSync("sacrificial-scroll-error", { error: String(error?.message || error) });
    }
  }

  function discoverApiTemplatesFromPerformance() {
    const entries = performance.getEntriesByType("resource") || [];
    const perfCandidates = entries
      .map((entry) => String(entry?.name || ""))
      .filter((name) => isLinkedInApiCandidateUrl(name))
      .filter((name) => !isKnownIrrelevantApiUrl(name))
      .filter((name) => !/\/voyager-web\/|\/aero-v1\/|\/sc\/h\//i.test(name));
    const runtimeCandidates = Array.from(runtimeApiCandidates).filter((name) => !isKnownIrrelevantApiUrl(name));
    const combined = Array.from(new Set([...runtimeCandidates, ...perfCandidates]));
    const deduped = combined
      .sort((a, b) => scoreApiCandidateUrl(b) - scoreApiCandidateUrl(a))
      .slice(0, 50);
    const preferred = deduped.find((url) => /(?:[?&]start=\d+|start(?:%3A|:))/i.test(url));
    debugSync("api-template-discovery", {
      candidates: deduped.slice(0, 10),
      candidateCount: deduped.length,
      preferred: preferred || "",
      perfCandidateCount: perfCandidates.length,
      runtimeCandidateCount: runtimeCandidates.length,
    });
    return {
      candidates: deduped,
      templateUrl: preferred || deduped[0] || "",
    };
  }

  function rewriteStartInUrl(url, cursor) {
    const cursorObj =
      cursor && typeof cursor === "object"
        ? { start: Number(cursor.start || 0), paginationToken: String(cursor.paginationToken || "") }
        : { start: Number(cursor || 0), paginationToken: "" };
    const start = Math.max(0, Math.floor(Number(cursorObj.start) || 0));
    const paginationToken = String(cursorObj.paginationToken || "");

    let result = String(url || "");

    // KEY CHANGE: Prioritize paginationToken over simple start increments
    // LinkedIn's Saved Posts API requires paginationToken for cursor-based paging

    // 1. First handle GraphQL variables - this is the most important for Saved Posts
    if (result.includes("variables=")) {
      // LinkedIn variables can be double or triple encoded.
      // We split by variables= and then by & to isolate the variables blob.
      const parts = result.split("variables=");
      const rest = parts[1].split("&");
      let blob = rest[0];
      let decoded = blob;

      // Exhaustive recursive decode 
      for (let i = 0; i < 5; i++) {
        try {
          const next = decodeURIComponent(decoded);
          if (next === decoded) break;
          decoded = next;
        } catch { break; }
      }

      let changed = false;

      // PRIORITY 1: Update paginationToken FIRST if we have one
      // This is required for LinkedIn's Saved Posts cursor-based pagination
      if (paginationToken) {
        // Check for existing paginationToken and replace
        if (/paginationToken\s*[:%3a]+\s*[^,)\s%]+/i.test(decoded)) {
          decoded = decoded.replace(/paginationToken\s*[:%3a]+\s*[^,)\s%]+/i, `paginationToken:${paginationToken}`);
          changed = true;
        } else if (/\)\s*$/.test(decoded)) {
          // Add paginationToken to end of variables object
          decoded = decoded.replace(/\)\s*$/, `,paginationToken:${paginationToken})`);
          changed = true;
        } else if (/start\s*[:%3a]+\s*\d+/.test(decoded)) {
          // If start exists but paginationToken doesn't, add it after start
          decoded = decoded.replace(/start\s*[:%3a]+\s*\d+/, `$&,paginationToken:${paginationToken}`);
          changed = true;
        }
      }

      // PRIORITY 2: Also update start value if needed
      // Update start:N or start%3AN - but keep paginationToken if present
      if (/start\s*[:%3a]+\s*\d+/i.test(decoded)) {
        decoded = decoded.replace(/start\s*[:%3a]+\s*\d+/i, `start:${start}`);
        changed = true;
      }

      if (changed) {
        // Return decoded form. LinkedIn discovery prefers unencoded delimiters in variables=.
        // This solves the HTTP 400 caused by %253A mismatch.
        rest[0] = decoded;
        parts[1] = rest.join("&");
        result = parts.join("variables=");
      }
    }

    // 2. Handle standard query params (start, paginationToken)
    // For non-GraphQL endpoints
    if (result.includes("start=")) {
      result = result.replace(/([?&])start=\d+/i, `$1start=${start}`);
    }
    if (paginationToken) {
      if (result.includes("paginationToken=")) {
        result = result.replace(/([?&])paginationToken=[^&]+/i, `$1paginationToken=${paginationToken}`);
      } else {
        const sep = result.includes("?") ? "&" : "?";
        result += `${sep}paginationToken=${paginationToken}`;
      }
    }

    return result;
  }

  async function fetchApiPage({ templateUrl, cursor, csrfToken }) {
    const requestUrl =
      typeof templateUrl === "string" && /^https?:\/\//i.test(templateUrl)
        ? rewriteStartInUrl(templateUrl, cursor)
        : "";
    if (!requestUrl || !isLinkedInApiCandidateUrl(requestUrl)) {
      debugSync("api-fetch-invalid-url", { templateUrl, requestUrl, cursor });
      throw new Error("Missing template URL for page fetch");
    }

    // Build headers - LinkedIn's GraphQL API is sensitive to header casing
    const headers = {
      accept: "application/json, text/plain, */*",
      "x-restli-protocol-version": "2.0.0",
    };

    // Add CSRF token with correct casing for GraphQL endpoints
    if (csrfToken) {
      // For GraphQL endpoints, use the proper casing
      if (requestUrl.includes("/graphql") || requestUrl.includes("voyager/api")) {
        headers["Csrf-Token"] = String(csrfToken);
      } else {
        headers["csrf-token"] = String(csrfToken);
      }
    }

    debugSync("api-fetch-request", { cursor, requestUrl, hasCsrf: Boolean(csrfToken), isGraphQL: requestUrl.includes("/graphql") });
    const response = await fetch(requestUrl, {
      method: "GET",
      credentials: "include",
      headers,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      debugSync("api-fetch-http-error", { requestUrl, status: response.status, bodySample: text.slice(0, 300) });
      throw new Error(`HTTP ${response.status} while fetching ${requestUrl}`);
    }
    debugSync("api-fetch-response", {
      requestUrl,
      status: response.status,
      hasJson: Boolean(json && typeof json === "object"),
    });
    return {
      url: requestUrl,
      status: response.status,
      json,
      text: json ? "" : text.slice(0, 1000),
    };
  }

  // Cache for profile fetches to avoid duplicate requests
  const profileCache = new Map();

  async function fetchProfileByMiniProfileUrn(miniProfileUrn, csrfToken) {
    if (!miniProfileUrn) return null;
    if (profileCache.has(miniProfileUrn)) {
      return profileCache.get(miniProfileUrn);
    }

    console.log("[LSN PROFILE] Fetching profile:", miniProfileUrn);

    const profileId = miniProfileUrn.split(':').pop();

    // Try multiple endpoints
    const endpoints = [
      `https://www.linkedin.com/voyager/api/miniProfile?urn=${encodeURIComponent(miniProfileUrn)}`,
      `https://www.linkedin.com/voyager/api/identity/profiles/${profileId}/profileView`,
    ];

    for (const profileUrl of endpoints) {
      try {
        const response = await fetch(profileUrl, {
          method: "GET",
          credentials: "include",
          headers: {
            accept: "application/vnd.linkedin.normalized+json+2.1",
            ...(csrfToken ? { "Csrf-Token": String(csrfToken) } : {}),
          },
        });

        if (!response.ok) {
          console.log("[LSN PROFILE] Endpoint failed:", profileUrl.split('?')[0], response.status);
          continue;
        }

        const data = await response.json();
        console.log("[LSN PROFILE] Response from", profileUrl.split('?')[0].split('/').slice(-2).join('/'));

        // Try to extract name from various response formats
        let firstName = '';
        let lastName = '';

        // Format 1: Direct fields
        firstName = data?.firstName || '';
        lastName = data?.lastName || '';

        // Format 2: In included array
        if (!firstName && data?.included) {
          for (const entity of data.included) {
            if (entity?.firstName || entity?.lastName) {
              firstName = entity.firstName || '';
              lastName = entity.lastName || '';
              break;
            }
            if (entity?.name && typeof entity.name === 'string') {
              const parts = entity.name.split(' ');
              firstName = parts[0] || '';
              lastName = parts.slice(1).join(' ') || '';
              break;
            }
          }
        }

        // Format 3: Profile object
        if (!firstName && data?.profile) {
          firstName = data.profile.firstName || '';
          lastName = data.profile.lastName || '';
        }

        if (firstName || lastName) {
          const result = {
            firstName,
            lastName,
            name: `${firstName} ${lastName}`.trim()
          };
          console.log("[LSN PROFILE] Extracted name:", result.name);
          profileCache.set(miniProfileUrn, result);
          return result;
        }
      } catch (error) {
        console.log("[LSN PROFILE] Error:", error.message);
      }
    }

    // Fallback: Try fetching profile page and extracting from HTML
    if (profileId) {
      try {
        const profilePageUrl = `https://www.linkedin.com/in/${profileId}/`;
        console.log("[LSN PROFILE] Trying profile page:", profilePageUrl);

        const response = await fetch(profilePageUrl, {
          method: "GET",
          credentials: "include",
        });

        if (response.ok) {
          const html = await response.text();
          // Extract name from title tag or h1
          const titleMatch = html.match(/<title[^>]*>([^|<]+)/i);
          if (titleMatch?.[1]) {
            const name = titleMatch[1].trim().replace(/\s*\|.*/, '').trim();
            if (name && name.length > 2 && name.length < 60) {
              const result = { firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' '), name };
              console.log("[LSN PROFILE] Extracted from HTML:", name);
              profileCache.set(miniProfileUrn, result);
              return result;
            }
          }
        }
      } catch (error) {
        console.log("[LSN PROFILE] HTML fetch error:", error.message);
      }
    }

    profileCache.set(miniProfileUrn, { name: null });
    return null;
  }

  function collectCandidateUrls(value, out = []) {
    if (value == null) return out;
    if (typeof value === "string") {
      const text = String(value);
      const direct = text.match(/https?:\/\/[^\s"')<>{}]+/gi) || [];
      for (const url of direct) out.push(url);
      return out;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectCandidateUrls(item, out);
      return out;
    }
    if (typeof value === "object") {
      for (const key of Object.keys(value)) collectCandidateUrls(value[key], out);
    }
    return out;
  }

  function extractNextPageUrl(responseJson, currentUrl = "") {
    const urls = collectCandidateUrls(responseJson, [])
      .map((u) => {
        try {
          return new URL(u, window.location.origin).toString();
        } catch {
          return "";
        }
      })
      .filter(Boolean)
      .filter((u) => isLinkedInApiCandidateUrl(u));

    const unique = Array.from(new Set(urls));
    const currentNormalized = String(currentUrl || "");
    const nextLike = unique.filter((u) => {
      if (u === currentNormalized) return false;
      return /(?:[?&]start=\d+|count=\d+|cursor=|pageToken=|paginationToken=|next)/i.test(u);
    });
    if (nextLike.length > 0) return nextLike[0];
    const fallback = unique.find((u) => u !== currentNormalized);
    return fallback || "";
  }

  function findPagingHint(value, out = []) {
    if (!value || typeof value !== "object") return out;
    if (Array.isArray(value)) {
      for (const item of value) findPagingHint(item, out);
      return out;
    }
    const startRaw = value.start;
    const countRaw = value.count ?? value.pageSize ?? value.limit ?? value.size;
    const totalRaw = value.total ?? value.totalCount;
    const start = Number(startRaw);
    const count = Number(countRaw);
    const total = Number(totalRaw);
    if (Number.isFinite(start) && Number.isFinite(count) && count > 0) {
      out.push({
        start: Math.max(0, Math.floor(start)),
        count: Math.max(1, Math.floor(count)),
        total: Number.isFinite(total) ? Math.max(0, Math.floor(total)) : null,
      });
    }
    for (const key of Object.keys(value)) {
      findPagingHint(value[key], out);
    }
    return out;
  }

  function parseUrlPagingHint(url, fallbackStart = 0) {
    try {
      const parsed = new URL(String(url || ""), window.location.origin);
      const startParam = parsed.searchParams.get("start");
      const countParam = parsed.searchParams.get("count");
      const start = Number(startParam);
      const count = Number(countParam);
      if (Number.isFinite(start) && Number.isFinite(count) && count > 0) {
        return {
          start: Math.max(0, Math.floor(start)),
          count: Math.max(1, Math.floor(count)),
        };
      }
      const variables = String(parsed.searchParams.get("variables") || "");
      const startMatch = variables.match(/start\s*:\s*(\d+)/i);
      const countMatch = variables.match(/count\s*:\s*(\d+)/i);
      const vs = Number(startMatch?.[1]);
      const vc = Number(countMatch?.[1]);
      if (Number.isFinite(vs) && Number.isFinite(vc) && vc > 0) {
        return {
          start: Math.max(0, Math.floor(vs)),
          count: Math.max(1, Math.floor(vc)),
        };
      }
    } catch {
      // ignore
    }
    return {
      start: Math.max(0, Math.floor(Number(fallbackStart) || 0)),
      count: DEFAULT_PAGE_SIZE,
    };
  }

  function hasBooleanEndFlag(value) {
    const root = value && typeof value === "object" ? value : {};
    const directContainers = [
      root,
      root.paging,
      root.pagination,
      root.metadata,
      root.pageInfo,
    ].filter((x) => x && typeof x === "object");
    const endKeys = ["hasNext", "hasMore", "hasNextPage", "moreResultsAvailable"];
    for (const container of directContainers) {
      for (const key of endKeys) {
        if (Object.prototype.hasOwnProperty.call(container, key) && container[key] === false) {
          return true;
        }
      }
    }
    if (root?.paging && typeof root.paging === "object") {
      const p = root.paging;
      for (const key of Object.keys(p)) {
        const v = p[key];
        if (v && typeof v === "object") {
          for (const endKey of endKeys) {
            if (Object.prototype.hasOwnProperty.call(v, endKey) && v[endKey] === false) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  function hasExplicitEndSignal({ responseJson, nextStart, pagesFetched = 0 }) {
    const hints = findPagingHint(responseJson, []);

    // Only trust explicit end signals after fetching at least 50 pages
    // This prevents premature ending due to incorrect total counts per page
    const minimumPagesBeforeEndSignal = 50;

    // Log hints for debugging
    if (hints.length > 0) {
      console.log(`[LSN PAGINATION] Page ${pagesFetched}: Found ${hints.length} paging hints, nextStart: ${nextStart}`);
      hints.slice(0, 3).forEach((h, i) => {
        console.log(`[LSN PAGINATION] Hint ${i}: start=${h.start}, count=${h.count}, total=${h.total}`);
      });
    }

    for (const hint of hints) {
      // Ignore hints where total is very small (likely page size, not actual total)
      // A real total should be larger than a single page (at least 50 posts)
      if (hint.total != null && Number.isFinite(hint.total) && hint.total >= 50) {
        if (nextStart >= hint.total) {
          // Only trust total if we've fetched many pages
          if (pagesFetched >= minimumPagesBeforeEndSignal) {
            console.log(`[LSN PAGINATION] Explicit end triggered: nextStart(${nextStart}) >= total(${hint.total}), pagesFetched: ${pagesFetched}`);
            return true;
          }
        }
      }
    }

    // Trust boolean end flags only after minimum pages
    if (pagesFetched >= minimumPagesBeforeEndSignal) {
      const hasEnd = hasBooleanEndFlag(responseJson);
      if (hasEnd) {
        console.log(`[LSN PAGINATION] Boolean end flag found at page ${pagesFetched}`);
      }
      return hasEnd;
    }

    return false;
  }

  function discoverNextStart({ pageUrl, responseJson, currentStart, currentItemsCount }) {
    // First try to find paging hints in the response JSON
    const hints = findPagingHint(responseJson, []);

    debugSync("discover-next-start", {
      currentStart,
      currentItemsCount,
      hintsCount: hints.length,
      hints: hints.slice(0, 3),
    });

    if (hints.length > 0) {
      hints.sort((a, b) => b.count - a.count);
      const best = hints[0];
      const maybeNext = best.start + best.count;
      debugSync("discover-next-hint", { best, maybeNext });
      if (best.total != null && maybeNext >= best.total) {
        return maybeNext;
      }
      // If we got a reasonable count, use it
      if (best.count > 0) {
        return maybeNext;
      }
    }

    // Check URL for pagination params
    const urlHint = parseUrlPagingHint(pageUrl, currentStart);
    debugSync("discover-next-url-hint", { urlHint });
    if (urlHint.count > 0) {
      return urlHint.start + urlHint.count;
    }

    // Look for count in response metadata or config
    const countKeys = ["count", "pageSize", "limit", "pageSize", "resultsPerPage", "size"];
    let foundCount = 0;
    const searchCount = (obj, d = 0) => {
      if (d > 5 || !obj || typeof obj !== "object") return;
      for (const key of countKeys) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const val = Number(obj[key]);
          if (Number.isFinite(val) && val > 0 && val < 200) {
            foundCount = val;
            return;
          }
        }
      }
      if (obj.metadata) searchCount(obj.metadata, d + 1);
      if (obj.paging) searchCount(obj.paging, d + 1);
    };
    searchCount(responseJson);

    debugSync("discover-next-found-count", { foundCount });

    if (foundCount > 0) {
      return Math.max(0, Math.floor(Number(currentStart) || 0)) + foundCount;
    }

    // Default: assume we got items and advance by that amount
    const byItems = Math.max(10, Number(currentItemsCount) || 10);
    const nextStart = Math.max(0, Math.floor(Number(currentStart) || 0)) + byItems;
    debugSync("discover-next-default", { byItems, nextStart });
    return nextStart;
  }

  function extractPaginationToken(value, depth = 0) {
    if (depth > 8) return "";
    if (value == null) return "";
    if (typeof value === "string") {
      const v = String(value);
      const direct = v.match(/paginationToken["']?\s*[:=]\s*["']?([^"',)\s}]+)/i);
      if (direct?.[1]) return String(direct[1]);
      return "";
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const token = extractPaginationToken(item, depth + 1);
        if (token) return token;
      }
      return "";
    }
    if (typeof value === "object") {
      // Check common pagination keys first - including LinkedIn's new formats
      const tokenKeys = [
        "paginationToken",
        "nextPaginationToken",
        "cursor",
        "nextCursor",
        "pageToken",
        "nextPageToken",
        "anchorValue",
        "queryId"
      ];
      for (const key of tokenKeys) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const t = String(value[key] || "");
          if (t && t.length > 5 && !/^\d+$/.test(t)) return t;
        }
      }

      // Check for paging object with next token
      if (value.paging && typeof value.paging === "object") {
        const pagingToken = extractPaginationToken(value.paging, depth + 1);
        if (pagingToken) return pagingToken;
      }

      // Check for metadata with next token
      if (value.metadata && typeof value.metadata === "object") {
        const metaToken = extractPaginationToken(value.metadata, depth + 1);
        if (metaToken) return metaToken;
      }

      for (const key of Object.keys(value)) {
        // Skip non-pagination keys to avoid false positives
        if (key === "elements" || key === "data" || key === "results" || key === "items") continue;
        const token = extractPaginationToken(value[key], depth + 1);
        if (token) return token;
      }
    }
    return "";
  }

  function discoverNextCursor({ pageUrl, responseJson, currentCursor, currentItemsCount }) {
    const currentStart = Math.max(0, Math.floor(Number(currentCursor?.start || 0)));
    const nextStart = discoverNextStart({ pageUrl, responseJson, currentStart, currentItemsCount });

    // Try to extract a fresh pagination token from response
    let token = extractPaginationToken(responseJson);

    console.log("[LSN PAGINATION] Current start:", currentStart, "Next start:", nextStart);
    console.log("[LSN PAGINATION] Token found?:", !!token);
    console.log("[LSN PAGINATION] Items count:", currentItemsCount);

    // DEBUG: Log response structure to find pagination info
    if (responseJson && typeof responseJson === 'object') {
      console.log("[LSN PAGINATION] Response keys:", Object.keys(responseJson));
      if (responseJson.data) {
        console.log("[LSN PAGINATION] Response data keys:", Object.keys(responseJson.data));
        // Look for paging info in various locations
        const searchForPaging = (obj, path = '') => {
          for (const key of Object.keys(obj)) {
            const val = obj[key];
            const currentPath = path ? `${path}.${key}` : key;
            if (val && typeof val === 'object') {
              if (val.paging || val.pageInfo || val.metadata || val.totalResultCount !== undefined) {
                console.log(`[LSN PAGINATION] Found paging info at data.${currentPath}:`, {
                  paging: val.paging,
                  pageInfo: val.pageInfo,
                  metadata: val.metadata,
                  totalResultCount: val.totalResultCount
                });
                // Extract paginationToken if present
                if (val.paging?.paginationToken || val.metadata?.paginationToken) {
                  const foundToken = val.paging?.paginationToken || val.metadata?.paginationToken;
                  console.log(`[LSN PAGINATION] Found paginationToken:`, foundToken);
                  if (!token) token = foundToken;
                }
              }
              // Recurse into objects (but not arrays)
              if (!Array.isArray(val)) {
                searchForPaging(val, currentPath);
              }
            }
          }
        };
        searchForPaging(responseJson.data);
      }
    }

    // If no token found in response, check if we have a valid next start that differs from current
    // If so, continue with empty token (use offset-based pagination)
    if (!token) {
      const hasValidNextPage = nextStart > currentStart || currentItemsCount > 0;
      if (hasValidNextPage) {
        // Use offset-based pagination when no token is available
        token = "";
      }
    } else {
      // Use the token we found
      token = String(token);
    }

    return { start: nextStart, paginationToken: token };
  }

  function collectStringsDeep(value, out) {
    if (value == null) return;
    if (typeof value === "string") {
      out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectStringsDeep(item, out);
      return;
    }
    if (typeof value === "object") {
      for (const key of Object.keys(value)) collectStringsDeep(value[key], out);
    }
  }

  function collectObjectsDeep(value, out) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) collectObjectsDeep(item, out);
      return;
    }
    out.push(value);
    for (const key of Object.keys(value)) {
      collectObjectsDeep(value[key], out);
    }
  }

  async function extractFromJsonLdFallback() {
    // Fallback: extract data from JSON-LD in <code> tags
    // LinkedIn embeds serialized data in <code id="bpr-guid-..."> elements
    const results = [];
    try {
      const codeElements = document.querySelectorAll("code[id^='bpr-guid-'], code[id*='client-'], code[data-test-id*='bpr']");
      for (const codeEl of codeElements) {
        try {
          const text = codeEl.textContent || "";
          if (!text.trim() || text.length < 100) continue;

          // Try to parse as JSON
          let data = null;
          try {
            data = JSON.parse(text);
          } catch {
            // Try extracting JSON-like content
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                data = JSON.parse(jsonMatch[0]);
              } catch { continue; }
            } else {
              continue;
            }
          }

          if (data) {
            // Use extractApiItems to process this data
            const items = await extractApiItems(data);
            if (items.length > 0) {
              results.push(...items);
            }
          }
        } catch {
          // Skip problematic code elements
        }
      }
    } catch (e) {
      debugSync("json-ld-fallback-error", { error: String(e) });
    }

    debugSync("json-ld-fallback-results", { count: results.length });
    return results;
  }

  async function extractApiItems(payload, csrfToken = "") {
    // Handle Voyager Dash GraphQL format - check for "included" array first
    // Ensure payload is a valid object first
    if (!payload || typeof payload !== 'object') {
      console.log("[LSN EXTRACT] Invalid payload:", typeof payload);
      return [];
    }

    // DEBUG: Log the actual payload structure
    console.log("[LSN EXTRACT] Payload keys:", Object.keys(payload));
    console.log("[LSN EXTRACT] Has data?:", 'data' in payload);
    console.log("[LSN EXTRACT] Has included?:", 'included' in payload);
    console.log("[LSN EXTRACT] Has elements?:", 'elements' in payload);

    // Ensure we always have arrays to spread - be extra defensive
    let includedArray = [];
    let allData = [];

    try {
      if (payload && typeof payload === 'object') {
        // Try different paths to find the data
        if (Array.isArray(payload?.data?.included)) {
          includedArray = payload.data.included;
          console.log("[LSN EXTRACT] Found included in payload.data.included:", includedArray.length);
        } else if (Array.isArray(payload?.included)) {
          includedArray = payload.included;
          console.log("[LSN EXTRACT] Found included in payload.included:", includedArray.length);
        }

        // Try multiple paths for main data
        // Try multiple paths for data including LinkedIn's SearchDashClusters format
        const dataPaths = [
          'data.elements',
          'elements',
          'data.searchDashClustersByAll.elements',
          'data.searchDashClustersByAll',
          'data.results',
          'results'
        ];

        for (const path of dataPaths) {
          const parts = path.split('.');
          let val = payload;
          for (const part of parts) {
            val = val?.[part];
          }
          if (Array.isArray(val)) {
            console.log(`[LSN EXTRACT] Found array at ${path}:`, val.length);
            allData = val;
            break;
          }
        }

        // If still no data, try recursive search
        if (!allData.length && payload?.data && typeof payload.data === 'object') {
          const findArrays = (obj, path = '') => {
            for (const key of Object.keys(obj)) {
              const val = obj[key];
              const currentPath = path ? `${path}.${key}` : key;
              if (Array.isArray(val) && val.length > 0) {
                console.log(`[LSN EXTRACT] Found array at data.${currentPath}:`, val.length);
                return val;
              } else if (val && typeof val === 'object' && !Array.isArray(val)) {
                const result = findArrays(val, currentPath);
                if (result) return result;
              }
            }
            return null;
          };
          const found = findArrays(payload.data);
          if (found) allData = found;
        }
      }
    } catch (e) {
      console.log("[LSN EXTRACT] Error extracting arrays:", e);
      return [];
    }

    // Extra safety: ensure both are arrays before spreading
    const safeAllData = Array.isArray(allData) ? allData : [];
    const safeIncludedArray = Array.isArray(includedArray) ? includedArray : [];
    const combinedObjects = [...safeAllData, ...safeIncludedArray];

    console.log("[LSN EXTRACT] Combined objects count:", combinedObjects.length);

    // Collect all objects from the entire response
    const objects = [];
    collectObjectsDeep(combinedObjects, objects);
    if (objects.length === 0) {
      collectObjectsDeep(payload, objects);
    }

    console.log("[LSN EXTRACT] Total objects after deep collection:", objects.length);

    if (objects.length > 0) {
      // Log first object to see structure
      const sample = objects[0];
      console.log("[LSN EXTRACT] Sample object keys:", Object.keys(sample));
      console.log("[LSN EXTRACT] Sample has actor?:", 'actor' in sample);
      console.log("[LSN EXTRACT] Sample has entityUrn?:", 'entityUrn' in sample);
      console.log("[LSN EXTRACT] Sample has miniProfileUrn?:", 'miniProfileUrn' in sample);
    }

    // Build a lookup map for normalized entities (authors, etc.)
    // This is the key fix: map from the INCLUDED array for relational data
    const urnMap = new Map();
    const miniProfileMap = new Map();
    const entityUrnMap = new Map(); // For "urn:li:fs_member:XXX" style URNs
    const profileIdMap = new Map(); // Map internal IDs like "ACoAAC..." to profile objects

    for (const obj of objects) {
      // Collect all possible URN types
      const urn = String(obj?.entityUrn || obj?.trackingUrn || obj?.urn || "");
      const miniProfileUrn = String(obj?.miniProfileUrn || obj?.profileUrn || "");
      const dashId = String(obj?.dashEntityUrn || obj?.id || "");

      // Also extract URN from targetURN, actorUrn, etc.
      const targetUrn = String(obj?.targetUrn || "");
      const actorUrn = String(obj?.actorUrn || "");

      // Store in multiple maps for different lookup patterns
      if (urn && !urnMap.has(urn)) {
        urnMap.set(urn, obj);
      }
      if (miniProfileUrn && !miniProfileMap.has(miniProfileUrn)) {
        miniProfileMap.set(miniProfileUrn, obj);
      }
      if (dashId && !entityUrnMap.has(dashId)) {
        entityUrnMap.set(dashId, obj);
      }
      if (targetUrn && !urnMap.has(targetUrn)) {
        urnMap.set(targetUrn, obj);
      }
      if (actorUrn && !urnMap.has(actorUrn)) {
        urnMap.set(actorUrn, obj);
      }

      // Also index by normalized member URN (e.g., urn:li:fs_member:ACoAAA...)
      if (urn?.includes("fs_member")) {
        if (!urnMap.has(urn)) {
          urnMap.set(urn, obj);
        }
        // Extract the ID part (e.g., "ACoAAC...")
        const match = urn.match(/fs_member:([^\s]+)/);
        if (match?.[1]) {
          profileIdMap.set(match[1], obj);
        }
      }

      // For LinkedIn Search Cluster format: look for author in nested items
      // The author might be in a nested 'actor' or 'author' object
      if (obj?.actor && typeof obj.actor === "object") {
        const actorUrnFromObj = obj.actor.entityUrn || obj.actor.urn || obj.actor.miniProfileUrn;
        if (actorUrnFromObj && !urnMap.has(actorUrnFromObj)) {
          urnMap.set(actorUrnFromObj, obj.actor);
        }
      }

      // If this object has a name, it might be a profile - index by any ID we can find
      if (obj?.name || obj?.firstName) {
        const possibleIds = [
          obj?.entityUrn,
          obj?.urn,
          obj?.id,
          obj?.dashEntityUrn,
          obj?.miniProfileUrn,
          obj?.profileUrn
        ].filter(Boolean);

        for (const id of possibleIds) {
          if (typeof id === 'string') {
            // Extract just the ID part if it's a URN
            const match = id.match(/:([^:]+)$/);
            const shortId = match?.[1] || id;
            if (!profileIdMap.has(shortId)) {
              profileIdMap.set(shortId, obj);
            }
          }
        }
      }
    }

    // Log map sizes and sample profile IDs for debugging
    console.log("[LSN EXTRACT] Maps built:", {
      urnMapSize: urnMap.size,
      miniProfileMapSize: miniProfileMap.size,
      entityUrnMapSize: entityUrnMap.size,
      profileIdMapSize: profileIdMap.size,
      sampleProfileIds: Array.from(profileIdMap.keys()).slice(0, 5),
      sampleMiniProfileUrns: Array.from(miniProfileMap.keys()).slice(0, 5),
    });

    debugSync("extract-api-maps", {
      urnMapSize: urnMap.size,
      miniProfileMapSize: miniProfileMap.size,
      entityUrnMapSize: entityUrnMap.size,
      profileIdMapSize: profileIdMap.size,
    });

    const resultsByUrl = new Map();

    // Debug: sample what we're finding
    const debugSampleAuthors = [];

    // Log sample object keys to understand structure
    if (objects.length > 0) {
      const sampleObj = objects[0];
      console.log("[LSN EXTRACT] First object keys:", Object.keys(sampleObj || {}));
      console.log("[LSN EXTRACT] First object sample:", JSON.stringify(sampleObj).substring(0, 200));

      // Look for objects with LinkedIn URLs
      let objectsWithUrls = 0;
      let sampleUrlObj = null;
      for (const obj of objects.slice(0, 100)) {
        const strings = [];
        collectStringsDeep(obj, strings);
        const hasUrl = strings.some(s => /linkedin\.com/.test(s));
        if (hasUrl) {
          objectsWithUrls++;
          if (!sampleUrlObj) sampleUrlObj = obj;
        }
      }
      console.log("[LSN EXTRACT] Objects with LinkedIn URLs (first 100):", objectsWithUrls);
      if (sampleUrlObj) {
        console.log("[LSN EXTRACT] Sample URL object keys:", Object.keys(sampleUrlObj));
      }

      debugSync("extract-api-sample-obj", {
        keys: Object.keys(sampleObj || {}).slice(0, 20),
        hasActor: Boolean(sampleObj?.actor),
        hasEntityUrn: Boolean(sampleObj?.entityUrn),
        hasMiniProfileUrn: Boolean(sampleObj?.miniProfileUrn),
        actorType: typeof sampleObj?.actor,
      });
    }

    // Build a map of post URLs to EntityResultViewModel objects
    const entityResultMap = new Map();
    for (const obj of objects) {
      if (obj?.navigationUrl?.includes('/feed/update/') && obj?.title?.text) {
        const url = canonicalizePostUrl(obj.navigationUrl);
        if (url) {
          entityResultMap.set(url, obj);
        }
      }
    }
    console.log("[LSN EXTRACT] EntityResultViewModel map size:", entityResultMap.size);

    for (const obj of objects) {
      // We only care about objects that look like Updates or Search Results
      const strings = [];
      collectStringsDeep(obj, strings);

      // DEBUG: Log all LinkedIn URLs found in first few objects
      if (resultsByUrl.size < 3) {
        const allLinkedInUrls = strings.filter(s => /linkedin\.com/.test(s));
        if (allLinkedInUrls.length > 0) {
          console.log("[LSN EXTRACT] Object", resultsByUrl.size, "LinkedIn URLs:", allLinkedInUrls.slice(0, 3));
        }
      }

      // Extract post URL first
      let postUrl = "";

      // Check if this is an EntityResultViewModel (has navigationUrl with /feed/update/)
      if (obj?.navigationUrl?.includes('/feed/update/') && obj?.title?.text) {
        postUrl = canonicalizePostUrl(obj.navigationUrl);
      }

      // FALLBACK: Original string-based extraction
      if (!postUrl) {
        const postUrlRaw = strings.find((s) => /https:\/\/(www\.)?linkedin\.com\/(?:feed\/update\/|posts\/)/i.test(s));
        postUrl = canonicalizePostUrl(postUrlRaw || "");
      }
      if (!postUrl) {
        const urnRaw =
          strings.find((s) => /\burn:li:(?:activity|share|fs_updateV2|fs_savedpost):\d+\b/i.test(s)) ||
          String(obj?.entityUrn || obj?.trackingUrn || obj?.urn || "");
        const urnMatch = String(urnRaw || "").match(/\burn:li:(?:activity|share|fs_updateV2|fs_savedpost):([\d\w]+)\b/i);
        if (urnMatch?.[1]) {
          const id = urnMatch[1];
          if (urnMatch[0].includes("fs_updateV2") || urnMatch[0].includes("activity")) {
            postUrl = canonicalizePostUrl(`https://www.linkedin.com/feed/update/urn:li:activity:${id}/`);
          }
        }
      }

      if (!postUrl || resultsByUrl.has(postUrl)) continue;

      // Look up the EntityResultViewModel for this post URL
      let entityResult = entityResultMap.get(postUrl);
      
      if (!entityResult) {
        // Try to find by partial match
        for (const [url, erObj] of entityResultMap) {
          if (url.includes(postUrl) || postUrl.includes(url)) {
            entityResult = erObj;
            break;
          }
        }
      }

      // Extract data from EntityResultViewModel if found
      let possibleAuthor = "";
      let postMiniProfileUrn = "";
      let possibleText = "";
      let attachmentPreviewUrl = "";
      let attachmentType = "";
      let profileUrl = "";
      let dateLabelText = "";

      if (entityResult?.title?.text) {
        possibleAuthor = normalizeWhitespace(entityResult.title.text);
        possibleText = normalizeWhitespace(entityResult?.summary?.text || "");
        
        // Extract date from secondarySubtitle (e.g., "6mo •")
        if (entityResult?.secondarySubtitle?.text) {
          const rawDate = entityResult.secondarySubtitle.text;
          // Clean up: remove bullet points and extra spaces, keep just the time part
          dateLabelText = rawDate.replace(/[•·\s]+/g, " ").trim();
        }

        // Extract profile URL and miniProfileUrn from actorNavigationUrl
        if (entityResult?.actorNavigationUrl) {
          profileUrl = entityResult.actorNavigationUrl.split('?')[0]; // Clean URL without query params
          if (entityResult.actorNavigationUrl.includes('miniProfileUrn=')) {
            const urnMatch = entityResult.actorNavigationUrl.match(/miniProfileUrn=([^&]+)/);
            if (urnMatch?.[1]) {
              postMiniProfileUrn = decodeURIComponent(urnMatch[1]);
            }
          }
        }

        // Check entityEmbeddedObject for attachment info (most reliable)
        const embedded = entityResult?.entityEmbeddedObject;
        if (embedded?.article) {
          attachmentType = "article";
        } else if (embedded?.image?.attributes?.length > 0) {
          // Has embedded image = image post
          const accText = String(embedded.image.accessibilityText || "").toLowerCase();
          if (accText.includes("video")) {
            attachmentType = "video";
          } else {
            attachmentType = "image";
          }
        }

        // Check for document/PDF (template might indicate this)
        const template = entityResult?.template || "";
        if (template.includes('DOCUMENT')) {
          attachmentType = "document";
        }
      }

      // Extract miniProfileUrn from multiple sources (only if not already set)
      if (!postMiniProfileUrn) {
        const profileUrlMatch = strings.find(s => /miniProfileUrn=/.test(s) && /linkedin\.com\/in\//.test(s));
        if (profileUrlMatch) {
          const urnMatch = profileUrlMatch.match(/miniProfileUrn=([^&]+)/);
          if (urnMatch?.[1]) {
            postMiniProfileUrn = decodeURIComponent(urnMatch[1]);
          }
        }
      }

      // Author discovery - check if already found from EntityResultViewModel
      const authorDebug = { initial: possibleAuthor, foundVia: possibleAuthor ? "EntityResultViewModel" : "" };
      
      // PRIORITY 2: Direct author fields (if not already found)
      if (!possibleAuthor && (obj?.authorName || obj?.actorName || obj?.name)) {
        possibleAuthor = normalizeWhitespace(obj?.authorName || obj?.actorName || obj?.name || "");
        authorDebug.foundVia = "direct-field";
      }

      // Try actor with various URN formats
      if (!possibleAuthor && obj?.actor) {
        const actorObj = typeof obj.actor === "string" ? obj.actor : obj.actor;
        let actorUrn = "";

        // Check various URN fields on actor
        if (typeof actorObj === "object") {
          actorUrn = actorObj.miniProfileUrn || actorObj.profileUrn || actorObj.urn || actorObj.entityUrn || "";
        } else if (typeof actorObj === "string") {
          actorUrn = actorObj;
        }

        authorDebug.actorUrn = actorUrn;
        authorDebug.miniProfileMapHas = miniProfileMap.has(actorUrn);
        authorDebug.urnMapHas = urnMap.has(actorUrn);

        // Try miniProfile lookup first (most common for LinkedIn)
        if (actorUrn && miniProfileMap.has(actorUrn)) {
          const profile = miniProfileMap.get(actorUrn);
          possibleAuthor = normalizeWhitespace(
            profile?.firstName && profile?.lastName
              ? `${profile.firstName} ${profile.lastName}`
              : profile?.firstName || profile?.lastName || profile?.name || ""
          );
          authorDebug.foundVia = "miniProfileMap";
          authorDebug.profileKeys = Object.keys(profile || {}).slice(0, 10);
        }

        // Fall back to regular urnMap
        if (!possibleAuthor && actorUrn && urnMap.has(actorUrn)) {
          const resolvedActor = urnMap.get(actorUrn);
          possibleAuthor = normalizeWhitespace(
            resolvedActor?.firstName && resolvedActor?.lastName
              ? `${resolvedActor.firstName} ${resolvedActor.lastName}`
              : resolvedActor?.name || resolvedActor?.title?.text || resolvedActor?.actorName || ""
          );
          authorDebug.foundVia = "urnMap";
        }
      }

      // Try extracting from title.text
      if (!possibleAuthor && obj?.title?.text) {
        possibleAuthor = normalizeWhitespace(obj.title.text);
        authorDebug.foundVia = "title.text";
      }

      // Try extracting from miniProfileUrn directly in the object
      if (!possibleAuthor && obj?.miniProfileUrn && miniProfileMap.has(obj.miniProfileUrn)) {
        const profile = miniProfileMap.get(obj.miniProfileUrn);
        possibleAuthor = normalizeWhitespace(
          profile?.firstName && profile?.lastName
            ? `${profile.firstName} ${profile.lastName}`
            : profile?.firstName || profile?.lastName || profile?.name || ""
        );
        authorDebug.foundVia = "obj.miniProfileUrn";
      }

      // Try extracting from post URL as last resort
      if (!possibleAuthor) {
        const profileUrlMatch = postUrl.match(/\/in\/([^\/?#]+)/i);
        if (profileUrlMatch?.[1]) {
          const slug = profileUrlMatch[1].replace(/[-_]+/g, " ").replace(/\b\d+\b/g, "").trim();
          if (slug && slug.length > 2 && slug.length < 60) {
            possibleAuthor = toTitleCaseName(slug);
            authorDebug.foundVia = "URL";
          }
        }
      }

      // If still no author, search through ALL objects for a matching profile
      // This is needed for LinkedIn's Search Cluster format where profiles are separate
      if (!possibleAuthor) {
        // Extract miniProfileUrn from the post URL
        const miniProfileMatch = postUrl.match(/miniProfileUrn=([^&]+)/);
        if (miniProfileMatch?.[1]) {
          const decodedUrn = decodeURIComponent(miniProfileMatch[1]);
          console.log("[LSN EXTRACT] Looking for profile with URN:", decodedUrn);

          // Try to find in our maps
          // First try miniProfileMap
          if (miniProfileMap.has(decodedUrn)) {
            const profile = miniProfileMap.get(decodedUrn);
            console.log("[LSN EXTRACT] Found in miniProfileMap:", Object.keys(profile));
            if (profile.firstName && profile.lastName) {
              possibleAuthor = `${profile.firstName} ${profile.lastName}`;
              authorDebug.foundVia = "miniProfileMap-lookup";
            } else if (profile.name) {
              possibleAuthor = profile.name;
              authorDebug.foundVia = "miniProfileMap-lookup";
            }
          }

          // Try urnMap
          if (!possibleAuthor && urnMap.has(decodedUrn)) {
            const profile = urnMap.get(decodedUrn);
            console.log("[LSN EXTRACT] Found in urnMap:", Object.keys(profile));
            if (profile.firstName && profile.lastName) {
              possibleAuthor = `${profile.firstName} ${profile.lastName}`;
              authorDebug.foundVia = "urnMap-lookup";
            } else if (profile.name) {
              possibleAuthor = profile.name;
              authorDebug.foundVia = "urnMap-lookup";
            }
          }

          // Extract the ID part (e.g., "ACoAAC...")
          const idMatch = decodedUrn.match(/:([^:]+)$/);
          const shortId = idMatch?.[1];

          if (!possibleAuthor && shortId && profileIdMap.has(shortId)) {
            const profile = profileIdMap.get(shortId);
            console.log("[LSN EXTRACT] Found in profileIdMap:", Object.keys(profile));
            if (profile.firstName && profile.lastName) {
              possibleAuthor = `${profile.firstName} ${profile.lastName}`;
              authorDebug.foundVia = "profileIdMap-lookup";
            } else if (profile.name) {
              possibleAuthor = profile.name;
              authorDebug.foundVia = "profileIdMap-lookup";
            }
          }

          // Last resort: search through all objects
          if (!possibleAuthor) {
            console.log("[LSN EXTRACT] Searching all objects for URN:", decodedUrn);
            let foundCount = 0;
            for (const profileObj of objects) {
              // Check if this object has the matching URN
              const objUrn = profileObj?.entityUrn || profileObj?.urn || profileObj?.miniProfileUrn || "";
              if (objUrn === decodedUrn) {
                foundCount++;
                console.log("[LSN EXTRACT] Found matching profile object via loop:", Object.keys(profileObj));
                if (profileObj.firstName && profileObj.lastName) {
                  possibleAuthor = `${profileObj.firstName} ${profileObj.lastName}`;
                  authorDebug.foundVia = "profile-loop-lookup";
                  break;
                } else if (profileObj.name) {
                  possibleAuthor = profileObj.name;
                  authorDebug.foundVia = "profile-loop-lookup";
                  break;
                }
              }
            }
            if (foundCount === 0) {
              console.log("[LSN EXTRACT] No profile found for URN:", decodedUrn);
            }
          }
        }
      }

      // FINAL FALLBACK: Look for name patterns in strings
      // Sometimes the author name appears in text like "John Doe's post" or "John Doe • 2nd"
      if (!possibleAuthor) {
        const namePatterns = [
          // Match "First Last" pattern in strings (capitalized words)
          /^([A-Z][a-z]+\s+[A-Z][a-z]+)(?:\s*[•\-:]|$)/,
          // Match "First Last's post"
          /([A-Z][a-z]+\s+[A-Z][a-z]+)(?:'s|')\s+(?:post|article|comment)/i,
        ];

        for (const str of strings) {
          for (const pattern of namePatterns) {
            const match = str.match(pattern);
            if (match?.[1]) {
              const candidate = match[1].trim();
              // Validate it looks like a name (not a company, not too long)
              if (candidate.length > 3 && candidate.length < 40 && !candidate.includes("LinkedIn")) {
                possibleAuthor = candidate;
                authorDebug.foundVia = "pattern-match";
                break;
              }
            }
          }
          if (possibleAuthor) break;
        }

        // NEW: Look for strings that look like names (2-4 capitalized words) near profile URLs
        if (!possibleAuthor) {
          for (let i = 0; i < strings.length; i++) {
            const str = strings[i];
            // If this string is a profile URL
            if (/linkedin\.com\/in\//.test(str)) {
              // Check the string before it for a name
              if (i > 0) {
                const prevStr = strings[i - 1];
                const nameMatch = prevStr.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$/);
                if (nameMatch?.[1] && nameMatch[1].length > 3 && nameMatch[1].length < 40) {
                  possibleAuthor = nameMatch[1].trim();
                  authorDebug.foundVia = "profile-url-adjacent";
                  break;
                }
              }
            }
          }
        }

        // NEW: Look for standalone capitalized names in strings
        if (!possibleAuthor) {
          for (const str of strings) {
            // Match 2-4 capitalized words, 3-50 chars total
            if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(str) && str.length > 3 && str.length < 50) {
              // Exclude common non-name patterns
              if (!/\b(View|See|Open|Follow|Connect|Message|Like|Comment|Share|Post|Article|LinkedIn)\b/i.test(str)) {
                possibleAuthor = str.trim();
                authorDebug.foundVia = "capitalized-name";
                break;
              }
            }
          }
        }

        // NEW: First string is often the author name in LinkedIn's API
        if (!possibleAuthor && strings.length > 0) {
          const firstStr = strings[0];
          if (firstStr && firstStr.length > 2 && firstStr.length < 60 &&
            /^[A-Z]/.test(firstStr) &&
            !/\b(View|See|Open|Follow|Connect|Message|Like|Comment|Share|Post|Article|LinkedIn|http|www)\b/i.test(firstStr)) {
            possibleAuthor = firstStr.trim();
            authorDebug.foundVia = "first-string";
          }
        }

        // NEW: Look for name followed by degree/connection info (e.g., "John Doe • 2nd")
        if (!possibleAuthor) {
          for (const str of strings) {
            const match = str.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s*•\s*\d/);
            if (match?.[1] && match[1].length > 2 && match[1].length < 50) {
              possibleAuthor = match[1].trim();
              authorDebug.foundVia = "connection-pattern";
              break;
            }
          }
        }
      }

      // DOM FALLBACK: Extract author from visible page content
      // Since API doesn't include profile data, try to find it in the DOM
      if (!possibleAuthor && postUrl) {
        // Try to find the post card in the DOM that matches this URL
        const postCards = document.querySelectorAll('[data-test-id="search-entity-result"], .search-entity-result, [data-test-id="feed-component"]');
        for (const card of postCards) {
          const cardUrl = card.querySelector('a[href*="/feed/update/"]')?.href || '';
          if (cardUrl && postUrl.includes(cardUrl.split('?')[0])) {
            const domAuthor = extractAuthorFromProfileLinks(card);
            if (domAuthor) {
              possibleAuthor = domAuthor;
              authorDebug.foundVia = "dom-fallback";
              break;
            }
          }
        }
      }

      // DEEP SEARCH: Look for author info in nested objects within this object
      if (!possibleAuthor) {
        const findAuthorDeep = (currentObj, depth = 0) => {
          if (depth > 5 || !currentObj || typeof currentObj !== 'object') return null;

          // Check for direct author fields
          if (currentObj.name && typeof currentObj.name === 'string' && currentObj.name.length > 2) {
            return currentObj.name;
          }
          if (currentObj.firstName && currentObj.lastName) {
            return `${currentObj.firstName} ${currentObj.lastName}`;
          }
          if (currentObj.firstName) {
            return currentObj.firstName;
          }

          // Check for actor object
          if (currentObj.actor && typeof currentObj.actor === 'object') {
            const actorName = findAuthorDeep(currentObj.actor, depth + 1);
            if (actorName) return actorName;
          }

          // Check for author object
          if (currentObj.author && typeof currentObj.author === 'object') {
            const authorName = findAuthorDeep(currentObj.author, depth + 1);
            if (authorName) return authorName;
          }

          // Check for profile object
          if (currentObj.profile && typeof currentObj.profile === 'object') {
            const profileName = findAuthorDeep(currentObj.profile, depth + 1);
            if (profileName) return profileName;
          }

          // Recurse into child objects
          for (const key of Object.keys(currentObj)) {
            if (key === 'actor' || key === 'author' || key === 'profile') continue; // Already checked
            const val = currentObj[key];
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              const found = findAuthorDeep(val, depth + 1);
              if (found) return found;
            }
          }

          return null;
        };

        const deepAuthor = findAuthorDeep(obj);
        if (deepAuthor) {
          possibleAuthor = normalizeWhitespace(deepAuthor);
          authorDebug.foundVia = "deep-search";
        }
      }

      authorDebug.final = possibleAuthor;
      if (debugSampleAuthors.length < 5) {
        debugSampleAuthors.push(authorDebug);
      }

      // Text discovery - only if not already set from EntityResultViewModel
      if (!possibleText) {
        possibleText = normalizeWhitespace(
          obj?.commentary?.text?.text ||
          obj?.commentary?.text ||
          obj?.text?.text ||
          obj?.text ||
          obj?.description?.text ||
          obj?.headline?.text ||
          obj?.summary?.text ||
          strings.find(s => s.length > 50) ||
          strings.slice(0, 5).join(" ")
        );
      }

      // DEEP SEARCH: Look for text content in nested objects
      if (!possibleText || possibleText.length < 10) {
        const findTextDeep = (currentObj, depth = 0) => {
          if (depth > 5 || !currentObj || typeof currentObj !== 'object') return null;

          // Check for text fields
          const textFields = ['text', 'commentary', 'description', 'headline', 'summary', 'body', 'content'];
          for (const field of textFields) {
            if (currentObj[field]) {
              if (typeof currentObj[field] === 'string' && currentObj[field].length > 10) {
                return currentObj[field];
              }
              if (typeof currentObj[field] === 'object' && currentObj[field].text) {
                if (typeof currentObj[field].text === 'string' && currentObj[field].text.length > 10) {
                  return currentObj[field].text;
                }
              }
            }
          }

          // Recurse into child objects
          for (const key of Object.keys(currentObj)) {
            const val = currentObj[key];
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              const found = findTextDeep(val, depth + 1);
              if (found) return found;
            }
          }

          return null;
        };

        const deepText = findTextDeep(obj);
        if (deepText) {
          possibleText = normalizeWhitespace(deepText);
        }
      }

      const attachmentUrl = canonicalizeAttachmentUrl(
        strings.find((s) => /^https:\/\/(?!.*linkedin\.com\/(?:feed\/update\/|posts\/|in\/)).+/i.test(s)) || ""
      );

      // Use classifyAttachmentType to determine the type
      if (!attachmentType) {
        attachmentType = classifyAttachmentType(entityResult, strings);
      }

      const normalized = normalizeSavedPost({
        postUrl,
        authorName: pickBestAuthor([possibleAuthor]),
        dateLabel: dateLabelText || normalizeWhitespace(obj?.publishedAt || obj?.date || obj?.createdAt || obj?.subDescription?.text || ""),
        contentText: stripProfileHeaderNoise(possibleText).slice(0, 4000),
        contentType: attachmentType || "post",
        attachmentUrl,
        attachmentTitle: normalizeWhitespace(obj?.attachmentTitle || ""),
        attachmentType: attachmentType || "post",
        attachmentPreviewUrl,
        miniProfileUrn: postMiniProfileUrn,
        profileUrl,
      });

      resultsByUrl.set(postUrl, normalized);
    }

    const results = Array.from(resultsByUrl.values());

    // Fetch profiles for posts with unknown authors
    if (csrfToken) {
      const unknownAuthorPosts = results.filter(r => !r.authorName || r.authorName === "Unknown" || r.authorName === "Unknown author");
      console.log(`[LSN EXTRACT] Fetching profiles for ${unknownAuthorPosts.length} unknown authors`);

      for (const post of unknownAuthorPosts) {
        // Use the miniProfileUrn we extracted earlier
        const decodedUrn = post.miniProfileUrn;
        if (decodedUrn) {
          console.log(`[LSN EXTRACT] Fetching profile for:`, decodedUrn);

          const profile = await fetchProfileByMiniProfileUrn(decodedUrn, csrfToken);
          if (profile?.name) {
            console.log(`[LSN EXTRACT] Got profile name:`, profile.name);
            post.authorName = profile.name;
          }
        } else {
          console.log(`[LSN EXTRACT] No miniProfileUrn for post:`, post.postUrl?.substring(0, 60));
        }
      }
    }

    debugSync("extract-api-results", {
      resultsCount: results.length,
      sampleAuthors: results.slice(0, 3).map(r => r.authorName).filter(Boolean),
      authorDebugSamples: debugSampleAuthors.slice(0, 3),
    });

    return results;
  }

  async function reportSyncProgress(patch) {
    try {
      await sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, patch);
    } catch (error) {
      logError("reportSyncProgress", error);
    }
  }

  async function pushBatch(items, payload = {}) {
    const response = await sendMessage(MESSAGE_TYPES.INDEX_BATCH, {
      items,
      atEnd: Boolean(payload.atEnd),
      mode: payload.mode || currentSyncMode,
      cursor: payload.cursor ?? null,
      inFlight: Boolean(payload.inFlight),
      pagesFetched: Number(payload.pagesFetched || 0),
      newItems: Number(payload.newItems || 0),
      checkpoint: payload.checkpoint || null,
    });
    return response?.ok ? response.data : null;
  }

  async function runApiSync({ mode = "incremental", restart = false } = {}) {
    const normalizedMode = mode === "full" ? "full" : "incremental";
    if (runtimeInvalidated) return;
    if (syncInProgress) {
      // Never drop explicit full-sync requests; run them right after current sync finishes.
      if (normalizedMode === "full") {
        pendingSyncRequest = { mode: "full", restart: Boolean(restart) };
        debugSync("sync-queued", {
          requestedMode: normalizedMode,
          restart: Boolean(restart),
          runningMode: currentSyncMode,
        });
      } else {
        debugSync("sync-skipped-in-progress", {
          requestedMode: normalizedMode,
          runningMode: currentSyncMode,
        });
      }
      return;
    }
    syncInProgress = true;
    currentSyncMode = normalizedMode;
    debugSync("sync-start", { mode: normalizedMode, restart });
    try {
      const statusRes = await sendMessage(MESSAGE_TYPES.SYNC_STATUS, {});
      const currentState = statusRes?.ok ? statusRes.data || {} : {};
      let templateUrl = String(currentState.lastCheckpoint?.templateUrl || "");
      if (!isLinkedInApiCandidateUrl(templateUrl) || isKnownIrrelevantApiUrl(templateUrl)) {
        templateUrl = "";
      }
      let start = normalizedMode === "incremental" ? 0 : (restart ? 0 : Number(currentState.cursor || 0));
      let cursorState = {
        start,
        paginationToken: restart ? "" : String(currentState.lastCheckpoint?.paginationToken || ""),
      };
      const seenIds = new Set();
      let pagesFetched = 0;
      let newItems = 0;
      const stopOnKnown = normalizedMode === "incremental";
      let templateCandidates = [];

      await reportSyncProgress({
        status: "running",
        mode: normalizedMode,
        inFlight: true,
        pagesFetched: 0,
        newItems: 0,
        lastError: null,
      });

      const csrfToken = extractCsrfToken();
      const probe = discoverApiTemplatesFromPerformance();
      const discovered = Array.isArray(probe?.candidates)
        ? probe.candidates
          .map((x) => String(x || ""))
          .filter((x) => isLinkedInApiCandidateUrl(x) && !isKnownIrrelevantApiUrl(x))
        : [];
      if (!templateUrl) {
        templateUrl = String(probe?.templateUrl || "");
        if (!isLinkedInApiCandidateUrl(templateUrl)) {
          templateUrl = "";
        }
      }
      templateCandidates = templateUrl ? [templateUrl, ...discovered] : [...discovered];
      templateCandidates = Array.from(new Set(templateCandidates));
      templateCandidates.sort((a, b) => scoreApiCandidateUrl(b) - scoreApiCandidateUrl(a));
      const preferredLikely = templateCandidates.filter((url) => isLikelySavedPostsApiUrl(url));
      const runtimeLikely = Array.from(runtimeApiCandidates).filter((url) => isLikelySavedPostsApiUrl(url));
      if (preferredLikely.length === 0 && runtimeLikely.length === 0) {
        await runSacrificialScrollDiscovery();
        const probeAfterScroll = discoverApiTemplatesFromPerformance();
        const afterScrollCandidates = Array.isArray(probeAfterScroll?.candidates)
          ? probeAfterScroll.candidates
            .map((x) => String(x || ""))
            .filter((x) => isLinkedInApiCandidateUrl(x) && !isKnownIrrelevantApiUrl(x))
          : [];
        afterScrollCandidates.sort((a, b) => scoreApiCandidateUrl(b) - scoreApiCandidateUrl(a));
        const preferredAfterScroll = afterScrollCandidates.filter((url) => isLikelySavedPostsApiUrl(url));
        templateCandidates = preferredAfterScroll.length > 0 ? preferredAfterScroll : afterScrollCandidates.slice(0, 5);
        debugSync("sync-template-candidates-after-sacrificial-scroll", {
          candidates: templateCandidates,
          candidateCount: templateCandidates.length,
        });
      }
      if (preferredLikely.length > 0) {
        templateCandidates = preferredLikely;
      } else {
        // Keep a narrow non-empty fallback set so discovery never dead-ends solely due heuristics.
        templateCandidates = templateCandidates.slice(0, 5);
      }

      if (!templateCandidates.length) {
        try {
          const pageProbe = await fetchSavedPostsHtmlByUrl(window.location.href);
          const htmlApiCandidates = extractApiCandidatesFromHtml(pageProbe.html);
          for (const url of htmlApiCandidates) {
            runtimeApiCandidates.add(url);
          }
          debugSync("html-api-candidates", {
            discovered: htmlApiCandidates.slice(0, 12),
            count: htmlApiCandidates.length,
          });
        } catch (error) {
          debugSync("html-api-candidates-error", { error: String(error?.message || error) });
        }
        const probe2 = discoverApiTemplatesFromPerformance();
        const discovered2 = Array.isArray(probe2?.candidates)
          ? probe2.candidates
            .map((x) => String(x || ""))
            .filter((x) => isLinkedInApiCandidateUrl(x) && !isKnownIrrelevantApiUrl(x))
          : [];
        templateCandidates = Array.from(new Set(discovered2))
          .sort((a, b) => scoreApiCandidateUrl(b) - scoreApiCandidateUrl(a))
          .slice(0, 5);
        debugSync("sync-template-candidates-after-html-probe", {
          candidates: templateCandidates,
          candidateCount: templateCandidates.length,
        });
      }
      debugSync("sync-template-candidates", {
        fromCheckpoint: String(currentState.lastCheckpoint?.templateUrl || ""),
        chosenTemplate: templateUrl,
        candidates: templateCandidates.slice(0, 12),
        candidateCount: templateCandidates.length,
        start,
      });
      if (!templateCandidates.length) {
        // No API template discovered: try HTML pagination fallback first, then DOM click fallback.
        const fallbackCursor = normalizedMode === "full" ? start : currentState.cursor || 0;
        let fallbackResult = await runHtmlPaginationFallback({
          mode: normalizedMode,
          cursor: fallbackCursor,
          seenIds,
          pagesFetched: 0,
          newItems: 0,
        });
        if (!fallbackResult.reachedEnd) {
          fallbackResult = await runDomClickPaginationFallback({
            mode: normalizedMode,
            cursor: fallbackCursor,
            seenIds,
            pagesFetched: fallbackResult.pagesFetched,
            newItems: fallbackResult.newItems,
          });
        }
        const fullFallbackDone = normalizedMode === "full" && Boolean(fallbackResult.reachedEnd);
        const fallbackState = await pushBatch([], {
          atEnd: true,
          mode: normalizedMode,
          cursor: fallbackCursor,
          inFlight: false,
          pagesFetched: fallbackResult.pagesFetched,
          newItems: fallbackResult.newItems,
          checkpoint: { templateUrl: "", start: fallbackCursor, updatedAt: Date.now() },
        });
        await reportSyncProgress({
          status: normalizedMode === "full" ? (fullFallbackDone ? "completed" : "idle") : "completed",
          mode: normalizedMode,
          inFlight: false,
          pagesFetched: fallbackResult.pagesFetched,
          newItems: fallbackResult.newItems,
          cursor: fallbackCursor,
          checkedIncremental: normalizedMode === "incremental",
          completedFullSync: fullFallbackDone,
          lastSeenNewestPostId: currentState.lastSeenNewestPostId || null,
          ...(normalizedMode === "full"
            ? (fullFallbackDone
              ? { lastError: null }
              : { lastError: "Full sync paused before reaching end. Click Sync All to continue." })
            : { lastError: null }),
        });
        renderSyncStatus(fallbackState || currentState);
        await performSearch(1);
        debugSync("sync-end-no-template-fallback", {
          mode: normalizedMode,
          status: normalizedMode === "full" ? (fullFallbackDone ? "completed" : "idle") : "completed",
          pagesFetched: fallbackResult.pagesFetched,
          newItems: fallbackResult.newItems,
          reachedEnd: fullFallbackDone,
        });
        return;
      }

      const pageLimit = normalizedMode === "full" ? FULL_SYNC_PAGE_LIMIT : QUICK_CHECK_PAGE_LIMIT;
      let templateWorked = false;
      let reachedNaturalEnd = false;
      let interrupted = false;
      let interruptionMessage = "";
      let nextPageUrl = "";
      for (const candidate of templateCandidates) {
        if (!candidate) continue;
        templateUrl = candidate;
        debugSync("sync-candidate-start", { candidate: templateUrl, start });
        const initialStart = start;
        const initialCursor = { ...cursorState };
        let hadAnyItemsForCandidate = false;
        let candidateInterrupted = false;
        let candidateInterruptionMessage = "";
        let consecutiveEmptyPages = 0;
        for (let i = 0; i < pageLimit; i += 1) {
          let page = null;
          let fetchError = null;
          for (let attempt = 0; attempt <= PAGE_FETCH_RETRIES; attempt += 1) {
            try {
              const sourceUrl = nextPageUrl || templateUrl;
              if (!isLinkedInApiCandidateUrl(sourceUrl)) {
                throw new Error("Invalid paging template URL");
              }
              debugSync("sync-page-attempt", { candidate: templateUrl, sourceUrl, cursor: cursorState, attempt });
              page = await fetchApiPage({ templateUrl: sourceUrl, cursor: cursorState, csrfToken });
              fetchError = null;
              break;
            } catch (error) {
              fetchError = error;
              debugSync("sync-page-attempt-failed", {
                candidate: templateUrl,
                cursor: cursorState,
                attempt,
                error: String(error?.message || error),
              });
              if (attempt < PAGE_FETCH_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, PAGE_FETCH_RETRY_DELAY_MS));
              }
            }
          }
          if (!page) {
            candidateInterrupted = true;
            candidateInterruptionMessage = String(fetchError?.message || "Page fetch failed");
            break;
          }
          const responseJson = page?.json;
          if (!responseJson || typeof responseJson !== "object") {
            candidateInterrupted = true;
            candidateInterruptionMessage = "Received invalid response payload while syncing.";
            break;
          }
          let items = await extractApiItems(responseJson, csrfToken);

          // If no items from API, try JSON-LD fallback from DOM
          if (items.length === 0) {
            debugSync("api-fallback-triggered", { candidate: templateUrl });
            const fallbackItems = await extractFromJsonLdFallback();
            if (fallbackItems.length > 0) {
              items = fallbackItems;
              debugSync("api-fallback-success", { count: items.length });
            }
          }

          pagesFetched += 1;

          debugSync("sync-page-raw", {
            candidate: templateUrl,
            cursor: cursorState,
            pagesFetched,
            responseKeys: Object.keys(responseJson || {}).slice(0, 20),
            hasData: Boolean(responseJson?.data),
            hasElements: Boolean(responseJson?.elements),
            hasResults: Boolean(responseJson?.results),
          });

          const nextCursor = discoverNextCursor({
            pageUrl: page?.url || templateUrl,
            responseJson,
            currentCursor: cursorState,
            currentItemsCount: items.length,
          });
          nextPageUrl = extractNextPageUrl(responseJson, page?.url || "");
          const explicitEnd = hasExplicitEndSignal({ responseJson, nextStart: nextCursor.start, pagesFetched });
          debugSync("sync-page-processed", {
            candidate: templateUrl,
            cursor: cursorState,
            items: items.length,
            pagesFetched,
            nextCursor,
            nextPageUrl: nextPageUrl || "",
            explicitEnd,
          });

          if (items.length === 0) {
            consecutiveEmptyPages++;
            debugSync("sync-empty-page", {
              page: pagesFetched,
              explicitEnd,
              hadAnyItemsForCandidate,
              cursorState,
              nextCursor,
              consecutiveEmptyPages,
              responseJsonKeys: Object.keys(responseJson || {}).slice(0, 20),
            });

            // Only trust "explicit end" after at least one valid page for this candidate.
            if (explicitEnd && hadAnyItemsForCandidate) {
              reachedNaturalEnd = true;
              break;
            }

            // Allow a few consecutive empty pages before stopping
            if (consecutiveEmptyPages >= CONSECUTIVE_EMPTY_PAGES_LIMIT) {
              candidateInterrupted = true;
              candidateInterruptionMessage = `Sync stopped: ${CONSECUTIVE_EMPTY_PAGES_LIMIT} consecutive empty pages.`;
              break;
            }

            // Continue to next page even if this one was empty
            cursorState = nextCursor;
            start = nextCursor.start;
            await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
            continue;
          }

          // Reset consecutive empty pages counter when we get items
          consecutiveEmptyPages = 0;
          hadAnyItemsForCandidate = true;
          templateWorked = true;

          const stateAfterBatch = await pushBatch(items, {
            atEnd: false,
            mode: normalizedMode,
            cursor: start,
            paginationToken: cursorState.paginationToken || "",
            inFlight: true,
            pagesFetched,
            newItems: newItems + items.length,
            checkpoint: { templateUrl, start: cursorState.start, paginationToken: cursorState.paginationToken || "", updatedAt: Date.now() },
          });
          newItems += items.length;
          renderSyncStatus(stateAfterBatch || {});

          if (normalizedMode === "incremental" && stopOnKnown && currentState.lastSeenNewestPostId) {
            if (items.some((x) => x.id === currentState.lastSeenNewestPostId)) {
              break;
            }
          }
          const sameStart = Number(nextCursor.start) <= Number(cursorState.start);
          const currentToken = String(cursorState.paginationToken || "");
          const nextToken = String(nextCursor.paginationToken || "");
          const tokenChanged = currentToken !== nextToken;
          const hasActiveToken = currentToken.length > 5 || nextToken.length > 5;

          // Only stall if both start doesn't advance AND token didn't change (and we have an active token)
          const isStalled = sameStart && ((hasActiveToken && !tokenChanged) || (!hasActiveToken && !nextPageUrl));

          if (isStalled) {
            candidateInterrupted = true;
            candidateInterruptionMessage = "Sync paging stalled (no next cursor or start advancement).";
            debugSync("sync-candidate-stalled", { candidate: templateUrl, cursor: cursorState, nextCursor, sameStart, tokenChanged, hasActiveToken });
            break;
          }
          cursorState = nextCursor;
          start = nextCursor.start;
          if (explicitEnd) {
            reachedNaturalEnd = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
        }
        if (templateWorked || hadAnyItemsForCandidate) {
          if (candidateInterrupted && templateCandidates.length > 1) {
            debugSync("sync-candidate-interrupted-continue", {
              candidate: templateUrl,
              reason: candidateInterruptionMessage,
              start,
            });
            // Continue with next candidate from current cursor before declaring interruption.
            continue;
          }
          interrupted = candidateInterrupted;
          interruptionMessage = candidateInterruptionMessage;
          debugSync("sync-candidate-finished", {
            candidate: templateUrl,
            interrupted,
            reason: interruptionMessage,
            reachedNaturalEnd,
            pagesFetched,
            newItems,
            cursor: start,
          });
          break;
        }
        start = initialStart;
        cursorState = initialCursor;
        debugSync("sync-candidate-no-items", { candidate: templateUrl, resetStart: initialStart });
      }

      if (!templateWorked) {
        const fallbackCursor = normalizedMode === "full" ? start : currentState.cursor || 0;
        let fallbackResult = await runHtmlPaginationFallback({
          mode: normalizedMode,
          cursor: fallbackCursor,
          seenIds,
          pagesFetched,
          newItems,
        });
        if (!fallbackResult.reachedEnd) {
          fallbackResult = await runDomClickPaginationFallback({
            mode: normalizedMode,
            cursor: fallbackCursor,
            seenIds,
            pagesFetched: fallbackResult.pagesFetched,
            newItems: fallbackResult.newItems,
          });
        }
        const fullFallbackDone = normalizedMode === "full" && Boolean(fallbackResult.reachedEnd);
        const fallbackState = await pushBatch([], {
          atEnd: true,
          mode: normalizedMode,
          cursor: fallbackCursor,
          inFlight: false,
          pagesFetched: fallbackResult.pagesFetched,
          newItems: fallbackResult.newItems,
          checkpoint: { templateUrl: "", start: fallbackCursor, updatedAt: Date.now() },
        });
        await reportSyncProgress({
          status: normalizedMode === "full" ? (fullFallbackDone ? "completed" : "idle") : "completed",
          mode: normalizedMode,
          inFlight: false,
          pagesFetched: fallbackResult.pagesFetched,
          newItems: fallbackResult.newItems,
          cursor: fallbackCursor,
          checkedIncremental: normalizedMode === "incremental",
          completedFullSync: fullFallbackDone,
          lastSeenNewestPostId: currentState.lastSeenNewestPostId || null,
          ...(normalizedMode === "full"
            ? (fullFallbackDone
              ? { lastError: null }
              : { lastError: "Full sync paused before reaching end. Click Sync All to continue." })
            : {}),
        });
        renderSyncStatus(fallbackState || currentState);
        await performSearch(1);
        debugSync("sync-end-api-failed-dom-fallback", {
          mode: normalizedMode,
          status: normalizedMode === "full" ? (fullFallbackDone ? "completed" : "idle") : "completed",
          pagesFetched: fallbackResult.pagesFetched,
          newItems: fallbackResult.newItems,
          reachedEnd: fullFallbackDone,
        });
        return;
      }

      const fullCompleted = normalizedMode === "full" && reachedNaturalEnd && !interrupted;
      const completedPatch = {
        status: interrupted || (normalizedMode === "full" && !fullCompleted) ? "idle" : "completed",
        mode: normalizedMode,
        inFlight: false,
        pagesFetched,
        newItems,
        cursor: normalizedMode === "full" ? start : currentState.cursor || 0,
        checkedIncremental: normalizedMode === "incremental",
        completedFullSync: fullCompleted,
        lastSeenNewestPostId: currentState.lastSeenNewestPostId || null,
        ...(interrupted
          ? { lastError: interruptionMessage || "Sync was interrupted before reaching end of feed." }
          : normalizedMode === "full" && !fullCompleted
            ? { lastError: "Full sync paused before confirming end of feed." }
            : { lastError: null }),
      };
      if (newItems > 0) {
        const currentResults = await sendMessage(MESSAGE_TYPES.SEARCH_QUERY, { page: 1, pageSize: 1, queryText: "" });
        const first = currentResults?.ok ? currentResults.data?.results?.[0] : null;
        if (first?.id) {
          completedPatch.lastSeenNewestPostId = first.id;
        }
      }
      await reportSyncProgress(completedPatch);
      await pushBatch([], {
        atEnd: !interrupted,
        mode: normalizedMode,
        cursor: completedPatch.cursor,
        inFlight: false,
        pagesFetched,
        newItems,
        checkpoint: { templateUrl, start: completedPatch.cursor, updatedAt: Date.now() },
      });
      await performSearch(1);
      debugSync("sync-end", {
        mode: normalizedMode,
        status: completedPatch.status,
        fullCompleted,
        interrupted,
        interruptionMessage,
        pagesFetched,
        newItems,
        cursor: completedPatch.cursor,
        templateUrl,
      });

      // Show completion toast with actual total from DB
      const totalIndexed = completedPatch?.itemsIndexed || 0;
      showToast(`Sync complete! Total: ${totalIndexed} posts.`, 'success');
    } catch (error) {
      logError("runApiSync", error);
      debugSync("sync-error", { mode: currentSyncMode, error: String(error?.message || error) });
      await reportSyncProgress({
        status: "error",
        mode: currentSyncMode,
        inFlight: false,
        lastError: String(error?.message || error),
      });
      showToast(`Sync error: ${error?.message || 'Unknown error'}`, 'error');
    } finally {
      syncInProgress = false;
      currentSyncMode = "idle";
      const queued = pendingSyncRequest;
      pendingSyncRequest = null;
      if (queued) {
        debugSync("sync-run-queued", queued);
        setTimeout(() => {
          runApiSync(queued);
        }, 0);
      }
    }
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('lsn-toast-container') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `lsn-toast lsn-toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('lsn-toast-fade');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'lsn-toast-container';
    document.body.appendChild(container);
    return container;
  }


  function el(id) {
    return document.getElementById(id);
  }

  function findPreferredAsideHost() {
    const candidates = [
      "aside.grid__col.grid__col--lg-7[aria-label='Additional information']",
      "aside[aria-label='Additional information']",
      ".scaffold-layout__aside",
    ];
    for (const selector of candidates) {
      const host = document.querySelector(selector);
      if (host) return host;
    }
    return null;
  }

  function isHostVisible(host) {
    if (!host || !(host instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(host);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = host.getBoundingClientRect();
    return rect.width > 40 && rect.height > 40;
  }

  function buildSidebarRoot() {
    const root = document.createElement("section");
    root.id = "lsn-root";
    root.className = "lsn-root-floating";
    root.innerHTML = `
    <section id="lsn-panel">
      <div class="lsn-panel-content">
        <div id="lsn-collapsible-header">
          <header class="lsn-header">
            <div class="lsn-header-left">
              <div class="lsn-header-top">
                <svg class="lsn-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                <h2>Saved Navigator</h2>
              </div>
              <p id="lsn-progress">0 posts indexed</p>
            </div>
            <div class="lsn-header-actions">
              <button id="lsn-sync-all" title="Sync all your saved posts">Sync</button>
              <button id="lsn-restart-sync" title="Clear all data and sync from scratch">Clear & Resync</button>
              <button id="lsn-overlap-toggle" title="Enter Full Overlap Mode">⛶</button>
              <button id="lsn-close" title="Close panel">✕</button>
            </div>
          </header>
          <p id="lsn-runtime-notice" style="display:none;"></p>
          <div class="lsn-search-input-wrap">
            <svg class="lsn-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input id="lsn-q" name="lsn-q" autocomplete="off" placeholder="Search saved posts..." />
            <div id="lsn-search-suggestions" class="lsn-suggestions-menu" style="display:none;"></div>
          </div>
          <div class="lsn-filter-grid">
            <select id="lsn-author" name="lsn-author">
              <option value="">All authors</option>
            </select>
            <select id="lsn-type" name="lsn-type">
              <option value="">All types</option>
              <option value="post">Post</option>
              <option value="article">Article</option>
              <option value="video">Video</option>
              <option value="document">Document</option>
              <option value="image">Image</option>
            </select>
          </div>
          <details id="lsn-options" class="lsn-options">
            <summary>More filters</summary>
            <div class="lsn-filter-grid lsn-filter-grid-advanced">
              <input id="lsn-date-from" name="lsn-date-from" type="date" placeholder="From date" />
              <input id="lsn-date-to" name="lsn-date-to" type="date" placeholder="To date" />
            </div>
          </details>
        </div>
        <div class="lsn-toolbar">
          <button id="lsn-toggle-filters" title="Toggle filters">▲</button>
          <button id="lsn-search">Search</button>
          <button id="lsn-clear">Clear</button>
          <span class="lsn-results-count">No results yet.</span>
          <div class="lsn-pagination">
            <button id="lsn-prev" disabled>‹</button>
            <span id="lsn-page-label">1/1</span>
            <button id="lsn-next" disabled>›</button>
          </div>
        </div>
        <div id="lsn-results-list"></div>
      </div>
    </section>
  `;
    return root;
  }

  function makeDraggable(root) {
    if (!root || root.dataset.draggableInit === "true") return;
    root.dataset.draggableInit = "true";
    const dragHandle = root.querySelector(".lsn-drag-handle");
    if (!dragHandle) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const savedPos = localStorage.getItem("lsn-panel-position");
    if (savedPos) {
      try {
        const pos = JSON.parse(savedPos);
        if (typeof pos.left === "number" && typeof pos.top === "number") {
          root.style.left = `${pos.left}px`;
          root.style.top = `${pos.top}px`;
          root.style.right = "auto";
          root.style.bottom = "auto";
        }
      } catch (e) { }
    }

    const onMouseDown = (e) => {
      if (e.target.closest("button, input, select, a")) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = root.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      let newLeft = startLeft + deltaX;
      let newTop = startTop + deltaY;
      const maxLeft = window.innerWidth - root.offsetWidth - 10;
      const maxTop = window.innerHeight - root.offsetHeight - 10;
      newLeft = Math.max(10, Math.min(newLeft, maxLeft));
      newTop = Math.max(10, Math.min(newTop, maxTop));
      root.style.left = `${newLeft}px`;
      root.style.top = `${newTop}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      const rect = root.getBoundingClientRect();
      localStorage.setItem(
        "lsn-panel-position",
        JSON.stringify({ left: rect.left, top: rect.top })
      );
    };

    dragHandle.addEventListener("mousedown", onMouseDown);
  }

function injectDropdownTrigger() {
  if (document.getElementById("lsn-dropdown-trigger")) return;

  const sections = document.querySelectorAll("section.artdeco-card");
  let myItemsSection = null;
  for (const section of sections) {
    const h2 = section.querySelector("h2");
    if (h2 && h2.textContent.toLowerCase().includes("my items")) {
      myItemsSection = section;
      break;
    }
  }

  if (!myItemsSection) return;

  const itemDiv = document.createElement("div");
  itemDiv.className = "workflow-navigation__item";
  itemDiv.innerHTML = `
    <a id="lsn-dropdown-trigger" class="workflow-navigation__link link-without-hover-visited t-14" style="cursor:pointer;">
      <div class="workflow-navigation__item-name t-bold t-black--light truncate">
        Saved Navigator
      </div>
    </a>
  `;

  itemDiv.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const root = document.getElementById("lsn-root");
    if (root) {
      root.classList.toggle("lsn-root-hidden");
    }
  });

  myItemsSection.appendChild(itemDiv);
}

  function bindSidebarEvents() {
    const root = el("lsn-root");
    if (!root) {
      return;
    }
    if (root.dataset.boundVersion === SIDEBAR_BIND_VERSION) return;
    root.dataset.boundVersion = SIDEBAR_BIND_VERSION;

    el("lsn-close")?.addEventListener("click", () => {
      root.classList.add("lsn-root-hidden");
    });
    el("lsn-toggle-filters")?.addEventListener("click", () => {
      const header = el("lsn-collapsible-header");
      const btn = el("lsn-toggle-filters");
      if (!header) return;
      const collapsed = header.getAttribute("data-collapsed") === "true";
      header.setAttribute("data-collapsed", collapsed ? "false" : "true");
      if (btn) btn.textContent = collapsed ? "▲" : "▼";
    });
    el("lsn-sync-all")?.addEventListener("click", async () => {
      debugSync("ui-click-sync", { mode: "full" });
      await sendMessage(MESSAGE_TYPES.START_FULL_SYNC, { resume: true });
      runApiSync({ mode: "full", restart: false });
    });
    el("lsn-restart-sync")?.addEventListener("click", async () => {
      debugSync("ui-click-restart", { mode: "full", restart: true });
      await sendMessage(MESSAGE_TYPES.RESTART_FULL_SYNC, {});
      runApiSync({ mode: "full", restart: true });
    });
    el("lsn-overlap-toggle")?.addEventListener("click", () => {
      root.classList.toggle("lsn-root-overlap");
      const isOverlap = root.classList.contains("lsn-root-overlap");
      el("lsn-overlap-toggle").textContent = isOverlap ? "❐" : "⛶";
      el("lsn-overlap-toggle").title = isOverlap ? "Exit Full Overlap" : "Enter Full Overlap Mode";
    });
    el("lsn-search")?.addEventListener("click", () => performSearch(1));
    el("lsn-clear")?.addEventListener("click", () => clearFilters());
    el("lsn-prev")?.addEventListener("click", () => {
      if (searchState.page > 1) {
        performSearch(searchState.page - 1);
      }
    });
    el("lsn-next")?.addEventListener("click", () => {
      if (searchState.page < searchState.totalPages) {
        performSearch(searchState.page + 1);
      }
    });
    el("lsn-q")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        performSearch(1);
      }
    });
    const resizeHandle = el("lsn-resize-handle");
    if (resizeHandle) {
      resizeHandle.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const root = el("lsn-root");
        if (!root) return;
        const startX = Number(event.clientX || 0);
        const startWidth = clampPanelWidth(sidebarWidthPx);

        const onMove = (moveEvent) => {
          const delta = startX - Number(moveEvent.clientX || 0);
          sidebarWidthPx = clampPanelWidth(startWidth + delta);
          applySidebarWidth();
        };
        const onUp = async () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          await saveSidebarWidth(sidebarWidthPx);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
    }
    const resizeHandleY = el("lsn-resize-handle-y");
    if (resizeHandleY) {
      resizeHandleY.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const root = el("lsn-root");
        if (!root) return;
        const startY = Number(event.clientY || 0);
        const startHeight = clampPanelHeight(sidebarHeightPx);

        const onMove = (moveEvent) => {
          const delta = Number(moveEvent.clientY || 0) - startY;
          sidebarHeightPx = clampPanelHeight(startHeight + delta);
          applySidebarWidth();
        };
        const onUp = async () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          await saveSidebarHeight(sidebarHeightPx);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
    }
    el("lsn-author")?.addEventListener("change", () => {
      performSearch(1);
    });
    setupSearchAutocomplete();
  }

  function attachSidebarToHost(root, hostAside) {
    if (!root || !hostAside) return false;
    hostAside.classList.add("lsn-host-expanded");
    root.classList.remove("lsn-root-floating");
    const adCard = hostAside.querySelector(".ad-banner-container")?.closest("section.artdeco-card");
    if (adCard && adCard !== root) {
      adCard.replaceWith(root);
      return true;
    }
    if (root.parentElement !== hostAside) {
      hostAside.prepend(root);
      return true;
    }
    return true;
  }

  function attachSidebarFallback(root) {
    if (!root || !document.body) return false;
    root.classList.add("lsn-root-floating");
    if (root.parentElement !== document.body) {
      document.body.appendChild(root);
    }
    return true;
  }

  function createSidebar() {
    let root = document.getElementById("lsn-root");
    if (root && root.dataset.boundVersion && root.dataset.boundVersion !== SIDEBAR_BIND_VERSION) {
      root.remove();
      root = null;
    }
    if (!root) {
      root = buildSidebarRoot();
    }

    const hostAside = findPreferredAsideHost();
    if (hostAside && isHostVisible(hostAside)) {
      attachSidebarToHost(root, hostAside);
    } else {
      attachSidebarFallback(root);
    }
    bindSidebarEvents();
    // makeDraggable(root); // Disabled to prevent horizontal glitches
    injectDropdownTrigger();
    loadAuthorDropdown();
    return true;
  }

  function ensureSidebarMounted() {
    return createSidebar();
  }

  function scheduleEnsureSidebarMounted(delayMs = 120) {
    if (sidebarEnsureTimer) {
      clearTimeout(sidebarEnsureTimer);
    }
    sidebarEnsureTimer = setTimeout(() => {
      sidebarEnsureTimer = null;
      ensureSidebarMounted();
    }, delayMs);
  }

  function startSidebarMountWatcher() {
    if (sidebarMountObserver || !document.body) {
      return;
    }
    sidebarMountObserver = new MutationObserver(() => {
      scheduleEnsureSidebarMounted(120);
    });
    sidebarMountObserver.observe(document.body, { childList: true, subtree: true });
  }

  function setPanelCollapsed(collapsed) {
    const panel = el("lsn-panel");
    if (!panel) return;
    panel.setAttribute("data-collapsed", collapsed ? "true" : "false");
    const btn = el("lsn-toggle");
    if (btn) btn.textContent = collapsed ? "Expand" : "Collapse";
  }

  function registerPanelToggleListener() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "LSN_TOGGLE_PANEL" && message?.type !== "LSN_SHOW_PANEL") {
        return false;
      }
      ensureSidebarMounted();
      const panel = el("lsn-panel");
      if (!panel) {
        sendResponse?.({ ok: false, error: "Panel not available" });
        return false;
      }
      if (message?.type === "LSN_SHOW_PANEL") {
        setPanelCollapsed(false);
      } else {
        const collapsed = panel.getAttribute("data-collapsed") === "true";
        setPanelCollapsed(!collapsed);
      }
      sendResponse?.({ ok: true });
      return false;
    });
  }

  function renderSyncStatus(data) {
    const status = data?.status || "idle";
    const indexed = Number(data?.itemsIndexed || 0);
    const lastError = String(data?.lastError || "").trim();
    const progress = el("lsn-progress");
    if (!progress) return;
    if (status === "running") {
      progress.textContent = `Syncing... ${indexed} posts`;
      return;
    }
    if (status === "completed") {
      progress.textContent = `${indexed} posts indexed`;
      loadAuthorDropdown();
      return;
    }
    if (status === "error" || lastError) {
      progress.textContent = lastError || "Sync error";
      return;
    }
    progress.textContent = `${indexed} posts indexed`;
  }

  async function loadAuthorDropdown() {
    const select = el("lsn-author");
    if (!select) return;
    const response = await sendMessage(MESSAGE_TYPES.AUTHOR_SUGGESTIONS, { query: "", limit: 1000 });
    if (!response?.ok) return;
    const rows = Array.isArray(response.data?.authors) ? response.data.authors : [];
    const currentValue = select.value;
    select.innerHTML = '<option value="">All authors</option>';
    rows.sort((a, b) => (b.count || 0) - (a.count || 0));
    for (const row of rows) {
      const name = normalizeWhitespace(row?.name || "");
      if (!name) continue;
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = `${name} (${row.count || 0})`;
      select.appendChild(opt);
    }
    if (currentValue && rows.some(r => normalizeWhitespace(r?.name || "") === currentValue)) {
      select.value = currentValue;
    }
  }

  async function fetchAuthorSuggestions(query) {
    const response = await sendMessage(MESSAGE_TYPES.AUTHOR_SUGGESTIONS, { query, limit: 20 });
    if (!response?.ok) return [];
    const rows = Array.isArray(response.data?.authors) ? response.data.authors : [];
    return rows.map((x) => ({
      name: normalizeWhitespace(x?.name || ""),
      count: Number(x?.count || 0),
    }));
  }

  async function fetchSearchSuggestions(query) {
    if (!query || query.length < 2) return [];
    const response = await sendMessage(MESSAGE_TYPES.SEARCH_QUERY, {
      page: 1,
      pageSize: 5,
      queryText: query,
    });
    if (!response?.ok) return [];
    const posts = Array.isArray(response.data?.results) ? response.data.results : [];
    return posts.map((p) => ({
      id: p?.id || "",
      text: (p?.contentText || "").slice(0, 80),
    }));
  }

  function renderSearchSuggestions() {
    const menu = el("lsn-search-suggestions");
    if (!menu) return;
    if (!searchSuggestionsState.open || searchSuggestionsState.items.length === 0) {
      menu.style.display = "none";
      menu.innerHTML = "";
      return;
    }
    menu.style.display = "block";
    menu.innerHTML = searchSuggestionsState.items
      .map((item, idx) => {
        const selected = idx === searchSuggestionsState.highlight;
        return `<button type="button" class="lsn-suggestion-item${selected ? " active" : ""}" data-suggestion-idx="${idx}">
          ${escapeHtml(item.text)}${item.text.length >= 80 ? "..." : ""}
        </button>`;
      })
      .join("");

    menu.querySelectorAll(".lsn-suggestion-item").forEach((node) => {
      node.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const idx = Number(node.getAttribute("data-suggestion-idx"));
        const picked = searchSuggestionsState.items[idx];
        if (!picked) return;
        const input = el("lsn-q");
        if (input) input.value = picked.text;
        searchSuggestionsState.open = false;
        searchSuggestionsState.highlight = -1;
        renderSearchSuggestions();
        input?.focus();
      });
    });
  }

  function setupSearchAutocomplete() {
    const input = el("lsn-q");
    if (!input) return;
    let timer = null;

    input.addEventListener("input", () => {
      const query = String(input.value || "");
      if (timer) clearTimeout(timer);
      if (query.length < 2) {
        searchSuggestionsState.open = false;
        searchSuggestionsState.items = [];
        renderSearchSuggestions();
        return;
      }
      timer = setTimeout(async () => {
        searchSuggestionsState.items = await fetchSearchSuggestions(query);
        searchSuggestionsState.open = searchSuggestionsState.items.length > 0;
        searchSuggestionsState.highlight = -1;
        renderSearchSuggestions();
      }, 300);
    });

    input.addEventListener("focus", async () => {
      const query = String(input.value || "");
      if (query.length >= 2) {
        searchSuggestionsState.items = await fetchSearchSuggestions(query);
        searchSuggestionsState.open = searchSuggestionsState.items.length > 0;
        searchSuggestionsState.highlight = -1;
        renderSearchSuggestions();
      }
    });

    input.addEventListener("keydown", (e) => {
      if (!searchSuggestionsState.open) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        searchSuggestionsState.highlight = Math.min(
          searchSuggestionsState.highlight + 1,
          searchSuggestionsState.items.length - 1
        );
        renderSearchSuggestions();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        searchSuggestionsState.highlight = Math.max(searchSuggestionsState.highlight - 1, 0);
        renderSearchSuggestions();
        return;
      }
      if (e.key === "Enter") {
        if (searchSuggestionsState.highlight >= 0 && searchSuggestionsState.items[searchSuggestionsState.highlight]) {
          e.preventDefault();
          const picked = searchSuggestionsState.items[searchSuggestionsState.highlight];
          input.value = picked.text;
          searchSuggestionsState.open = false;
          searchSuggestionsState.highlight = -1;
          renderSearchSuggestions();
          return;
        }
      }
      if (e.key === "Escape") {
        searchSuggestionsState.open = false;
        renderSearchSuggestions();
      }
    });

    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !el("lsn-search-suggestions")?.contains(e.target)) {
        searchSuggestionsState.open = false;
        renderSearchSuggestions();
      }
    });
  }

  function escapeHtml(input) {
    return String(input || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function getFiltersFromUi() {
    const typeValue = el("lsn-type")?.value || "";
    const monthValue = Number(el("lsn-month")?.value || 0);
    const authorValue = normalizeWhitespace(el("lsn-author")?.value || "");

    return {
      dateFrom: el("lsn-date-from")?.value || "",
      dateTo: el("lsn-date-to")?.value || "",
      months: monthValue > 0 ? [monthValue] : [],
      dayOfWeek: [],
      dayOfMonth: [],
      authors: authorValue ? [authorValue] : [],
      contentTypes: typeValue ? [typeValue] : [],
    };
  }

  function renderResults(payload) {
    const list = el("lsn-results-list");
    const meta = document.querySelector(".lsn-results-count");
    const prevBtn = el("lsn-prev");
    const nextBtn = el("lsn-next");
    const pageLabel = el("lsn-page-label");
    if (!list || !meta || !prevBtn || !nextBtn || !pageLabel) return;
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const total = Number(payload?.total || 0);
    const page = Math.max(1, Number(payload?.page || 1));
    const pageSize = Math.max(1, Number(payload?.pageSize || DEFAULT_PAGE_SIZE));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    searchState.page = page;
    searchState.totalPages = totalPages;
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= totalPages;
    pageLabel.textContent = `${page}/${totalPages}`;
    meta.textContent = `${total} posts`;

    if (results.length === 0) {
      list.innerHTML = "<p class='lsn-empty'>No matches.</p>";
      return;
    }

    list.innerHTML = results
      .map((post) => {
        // Try to extract author from DOM if unknown
        let authorName = post.authorName;
        if (!authorName || authorName === "Unknown") {
          // Try to find this post in the DOM and extract author
          const postUrl = post.postUrl || "";
          const activityId = postUrl.match(/activity:(\d+)/)?.[1];
          if (activityId) {
            const card = document.querySelector(`a[href*="${activityId}"]`);
            if (card) {
              const cardContainer = card.closest('[data-test-id="search-entity-result"], .search-entity-result, article') || card.parentElement?.parentElement;
              if (cardContainer) {
                const domAuthor = extractAuthorFromProfileLinks(cardContainer);
                if (domAuthor && domAuthor !== "Unknown") {
                  authorName = domAuthor;
                }
              }
            }
          }
        }
        const author = escapeHtml(authorName || "Unknown author");
        const rawText = String(post.contentText || "").trim();
        const clipped = rawText.length > 220 ? `${rawText.slice(0, 220).trim()}...` : rawText;
        const text = escapeHtml(clipped);
        const date = escapeHtml(formatDisplayDate(post.postDate, post.dateLabel));
        const resolvedType = resolveDisplayType(post);
        const type = escapeHtml(formatTypeLabel(resolvedType));
        const hasProfile = Boolean(post.profileUrl);
        return `
        <article class="lsn-result">
          <div class="lsn-result-top">
            <strong>${author}</strong>
            <span class="lsn-result-type">${type}</span>
          </div>
          <p>${text || "(No text extracted)"}</p>
          <div class="lsn-result-bottom">
            <span class="lsn-result-date">${date || "No date"}</span>
            <div class="lsn-result-actions">
              <button data-open-id="${post.id}" class="lsn-open">Open Post</button>
              ${hasProfile
            ? `<button data-open-profile-id="${post.id}" class="lsn-open-profile">Open Profile</button>`
            : ""
          }
            </div>
          </div>
        </article>
      `;
      })
      .join("");

    list.querySelectorAll(".lsn-open").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const postId = btn.getAttribute("data-open-id");
        if (!postId) return;
        await sendMessage(MESSAGE_TYPES.OPEN_POST, { postId });
      });
    });
    list.querySelectorAll(".lsn-open-profile").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const postId = btn.getAttribute("data-open-profile-id");
        if (!postId) return;
        await sendMessage(MESSAGE_TYPES.OPEN_PROFILE, { postId });
      });
    });
  }

  function formatDisplayDate(isoValue, fallbackLabel = "") {
    const fromIso = String(isoValue || "").trim();
    const fromLabel = String(fallbackLabel || "").trim();
    const parsed = Date.parse(fromIso);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
    return fromLabel;
  }

  function formatTypeLabel(value) {
    const v = String(value || "unknown").toLowerCase();
    if (!v) return "Unknown";
    return v.charAt(0).toUpperCase() + v.slice(1);
  }

  function resolveDisplayType(post) {
    const base = String(post?.contentType || "unknown").toLowerCase();
    const attachment = String(post?.attachmentType || "").toLowerCase();
    if (attachment && attachment !== "unknown" && (base === "unknown" || base === "image" || base === "video")) {
      return attachment;
    }
    return base;
  }

  async function performSearch(page = 1) {
    try {
      const queryText = el("lsn-q")?.value || "";
      const filters = getFiltersFromUi();
      const allMatches = Boolean(el("lsn-all-matches")?.checked);
      const response = await sendMessage(MESSAGE_TYPES.SEARCH_QUERY, {
        queryText,
        filters,
        page,
        pageSize: allMatches ? ALL_MATCHES_PAGE_SIZE : DEFAULT_PAGE_SIZE,
      });
      if (response?.ok) {
        renderResults(response.data);
        return;
      }
      const list = el("lsn-results-list");
      if (list) {
        list.innerHTML = `<p class="lsn-empty">Search failed: ${escapeHtml(response?.error || "unknown error")}</p>`;
      }
    } catch (e) {
      logError("performSearch", e);
      const list = el("lsn-results-list");
      if (list) {
        list.innerHTML = `<p class="lsn-empty">Search failed: ${escapeHtml(String(e?.message || e))}</p>`;
      }
    }
  }

  function clearFilters() {
    const ids = ["lsn-q", "lsn-author", "lsn-date-from", "lsn-date-to", "lsn-month", "lsn-type"];
    for (const id of ids) {
      const node = el(id);
      if (!node) continue;
      node.value = "";
    }
    if (el("lsn-all-matches")) {
      el("lsn-all-matches").checked = false;
    }
    const optionsDetails = el("lsn-options");
    if (optionsDetails) {
      optionsDetails.removeAttribute("open");
    }
    performSearch(1);
  }

  async function runQuickCheckIfIdle() {
    if (syncInProgress || runtimeInvalidated) return;
    await sendMessage(MESSAGE_TYPES.RUN_INCREMENTAL_CHECK, { stopOnKnown: true });
    runApiSync({ mode: "incremental", restart: false });
  }

  async function pollSyncStatus() {
    if (runtimeInvalidated) {
      return;
    }
    try {
      const response = await sendMessage(MESSAGE_TYPES.SYNC_STATUS, {});
      if (response?.invalidated) {
        return;
      }
      if (response?.ok) {
        renderSyncStatus(response.data);
      }
    } catch (e) {
      if (isRuntimeInvalidationError(e)) {
        handleRuntimeInvalidation(e);
        return;
      }
      logError("status poll failed", e);
    } finally {
      if (!runtimeInvalidated) {
        statusPollTimer = setTimeout(pollSyncStatus, POLL_MS);
      }
    }
  }

  function bootstrapOnce() {
    if (window.__LSN_BOOTSTRAPPED__) {
      return;
    }
    if (window.top !== window.self) {
      return;
    }
    if (!/linkedin\.com\/my-items\/saved-posts/i.test(window.location.href)) {
      return;
    }
    window.__LSN_BOOTSTRAPPED__ = true;
    installDebugHelpers();
    ensureSidebarMounted();
    startSidebarMountWatcher();
    applySidebarWidth();
    sidebarBootstrapRetryTimer = setInterval(() => {
      ensureSidebarMounted();
      applySidebarWidth();
    }, 1000);
    setTimeout(() => {
      if (sidebarBootstrapRetryTimer) {
        clearInterval(sidebarBootstrapRetryTimer);
        sidebarBootstrapRetryTimer = null;
      }
    }, 15000);
    registerPanelToggleListener();
    pollSyncStatus();
    performSearch(1);

    // Avoid auto sync-on-load; user-triggered sync provides deterministic behavior.

    window.addEventListener("error", (event) => {
      logError("window error", event?.error || event?.message || "unknown error");
    });

    window.addEventListener("unhandledrejection", (event) => {
      logError("unhandled rejection", event?.reason || "unknown rejection");
    });
    window.addEventListener("resize", () => {
      sidebarWidthPx = clampPanelWidth(sidebarWidthPx);
      sidebarHeightPx = clampPanelHeight(sidebarHeightPx);
      applySidebarWidth();
    });
    window.addEventListener("beforeunload", () => {
      if (sidebarMountObserver) {
        sidebarMountObserver.disconnect();
        sidebarMountObserver = null;
      }
      if (sidebarEnsureTimer) {
        clearTimeout(sidebarEnsureTimer);
        sidebarEnsureTimer = null;
      }
      if (sidebarBootstrapRetryTimer) {
        clearInterval(sidebarBootstrapRetryTimer);
        sidebarBootstrapRetryTimer = null;
      }
    });

  }

  async function init() {
    installPageApiProbe();
    await loadSidebarWidth();
    bootstrapOnce();
  }

  init();

}
