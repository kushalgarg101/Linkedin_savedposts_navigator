const MESSAGE_TYPES = Object.freeze({
  SYNC_START: "SYNC_START",
  SYNC_PAUSE: "SYNC_PAUSE",
  SYNC_RESUME: "SYNC_RESUME",
  SYNC_STATUS: "SYNC_STATUS",
  INDEX_BATCH: "INDEX_BATCH",
  SEARCH_QUERY: "SEARCH_QUERY",
  OPEN_POST: "OPEN_POST",
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
  ".update-components-actor__name",
  ".entity-result__title-text",
  "h3",
];

const DATE_SELECTORS = [
  "time",
  ".update-components-actor__sub-description",
  ".entity-result__primary-subtitle",
];

const TEXT_SELECTORS = [
  ".update-components-text",
  ".feed-shared-update-v2__description",
  ".entity-result__summary",
  "span[dir='ltr']",
];

const TICK_MS = 1100;
const MAX_EMPTY_CYCLES = 8;
const MAX_STAGNANT_CYCLES = 6;
const MAX_TICKS = 4000;
const LOAD_WAIT_MS = 2600;
const POLL_MS = 1500;
const DEFAULT_PAGE_SIZE = 50;
const ALL_MATCHES_PAGE_SIZE = 200;

const searchState = {
  page: 1,
  totalPages: 1,
};
let runtimeInvalidated = false;
let statusPollTimer = null;

function logError(context, error) {
  const detail = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error);
  console.error(`[LSN] ${context}: ${detail}`);
}

function isRuntimeInvalidationError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("extension context invalidated");
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
  if (window.__LSN_SYNC_ENGINE__?.forceStop) {
    window.__LSN_SYNC_ENGINE__.forceStop();
  }
  if (statusPollTimer) {
    clearTimeout(statusPollTimer);
    statusPollTimer = null;
  }
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
  const t = String(text || "").toLowerCase();
  if (t.includes("video")) return "video";
  if (t.includes("document")) return "document";
  if (t.includes("article")) return "article";
  if (t.includes("image") || t.includes("photo")) return "image";
  return "unknown";
}

function parseDateLoose(value) {
  if (!value) return null;
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
  const idBase = [postUrl, authorName, contentText.slice(0, 120), postDate || dateLabel].join("|");
  const id = `lsn_${hashString(idBase)}`;

  return {
    id,
    postUrl,
    authorName,
    contentText,
    contentType: classifyContentType(contentText),
    dateLabel,
    postDate,
    savedAt: null,
    indexedAt: new Date().toISOString(),
    rawMeta: { source: "linkedin_saved_posts" },
  };
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
    return parsed.toString();
  } catch {
    return "";
  }
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

function getScrollContainer() {
  const candidates = [
    ".scaffold-finite-scroll",
    ".scaffold-finite-scroll__content",
    ".scaffold-layout__main",
    "main",
  ];

  for (const selector of candidates) {
    const node = document.querySelector(selector);
    if (node && node.scrollHeight > node.clientHeight + 100) {
      return node;
    }
  }
  return document.scrollingElement || document.documentElement;
}

function getScrollMetrics(container) {
  const scrollTop = Number(container.scrollTop || window.scrollY || 0);
  const clientHeight = Number(container.clientHeight || window.innerHeight || 0);
  const scrollHeight = Number(container.scrollHeight || document.body.scrollHeight || 0);
  return { scrollTop, clientHeight, scrollHeight };
}

function isNearBottom(container) {
  const { scrollTop, clientHeight, scrollHeight } = getScrollMetrics(container);
  return scrollTop + clientHeight >= scrollHeight - Math.max(160, Math.floor(clientHeight * 0.15));
}

function observeDomGrowth(target, timeoutMs = LOAD_WAIT_MS) {
  return new Promise((resolve) => {
    const observedTarget = target || document.querySelector("main") || document.body;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        observer.disconnect();
        resolve(false);
      }
    }, timeoutMs);

    const observer = new MutationObserver((mutations) => {
      const grew = mutations.some((m) => {
        const nodes = Array.from(m.addedNodes || []);
        return nodes.some((node) => node?.nodeType === Node.ELEMENT_NODE);
      });
      if (!grew || settled) return;
      settled = true;
      clearTimeout(timer);
      observer.disconnect();
      resolve(true);
    });
    observer.observe(observedTarget, { childList: true, subtree: true });
  });
}

function extractVisibleBatch(seenIds) {
  const cards = queryCards();
  const items = [];
  for (const card of cards) {
    const postUrl = canonicalizePostUrl(linkFromSelectors(card, LINK_SELECTORS));
    const authorName = textFromSelectors(card, AUTHOR_SELECTORS);
    const dateLabel = textFromSelectors(card, DATE_SELECTORS);
    const contentText = textFromSelectors(card, TEXT_SELECTORS) || card.textContent || "";
    if (!postUrl) {
      continue;
    }
    const normalized = normalizeSavedPost({ postUrl, authorName, dateLabel, contentText });
    if (seenIds.has(normalized.id)) {
      continue;
    }
    seenIds.add(normalized.id);
    items.push(normalized);
  }
  return items;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendMessage(type, payload = {}) {
  if (runtimeInvalidated) {
    throw new Error("Extension context invalidated. Refresh page.");
  }
  try {
    return await chrome.runtime.sendMessage({ type, payload });
  } catch (error) {
    if (isRuntimeInvalidationError(error)) {
      handleRuntimeInvalidation(error);
      throw new Error("Extension context invalidated. Refresh page.");
    }
    logError(`sendMessage ${type}`, error);
    throw error;
  }
}

async function tickScroll(container) {
  const step = Math.max(420, Math.floor(window.innerHeight * 0.82));
  if (container === document.scrollingElement || container === document.documentElement || container === document.body) {
    window.scrollBy(0, step);
  } else {
    container.scrollTop = container.scrollTop + step;
  }
  await sleep(180);
}

class GuidedSyncEngine {
  constructor() {
    this.running = false;
    this.paused = false;
    this.seenIds = new Set();
    this.emptyCycles = 0;
    this.stagnantCycles = 0;
    this.ticks = 0;
    this.scrollContainer = null;
    this.loopPromise = null;
  }

  async start({ reset = false } = {}) {
    if (this.running && !this.paused) {
      return;
    }
    if (reset) {
      this.seenIds.clear();
      this.emptyCycles = 0;
      this.stagnantCycles = 0;
      this.ticks = 0;
    }
    this.scrollContainer = getScrollContainer();
    this.running = true;
    this.paused = false;
    await sendMessage(MESSAGE_TYPES.SYNC_START, { reset });
    this.loopPromise = this.loop().catch((e) => {
      this.running = false;
      this.paused = false;
      this.loopPromise = null;
      logError("sync loop failed", e);
    });
  }

  async pause() {
    if (!this.running || this.paused) {
      return;
    }
    this.paused = true;
    await sendMessage(MESSAGE_TYPES.SYNC_PAUSE, {});
  }

  async resume() {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.running = true;
    await sendMessage(MESSAGE_TYPES.SYNC_RESUME, {});
    if (!this.loopPromise) {
      this.loopPromise = this.loop().catch((e) => {
        this.running = false;
        this.paused = false;
        this.loopPromise = null;
        logError("sync loop failed", e);
      });
    }
  }

  forceStop() {
    this.running = false;
    this.paused = false;
    this.loopPromise = null;
  }

  async loop() {
    while (this.running && !this.paused && this.ticks < MAX_TICKS) {
      const cardCountBefore = queryCards().length;
      const metricsBefore = getScrollMetrics(this.scrollContainer);
      const batch = extractVisibleBatch(this.seenIds);

      if (batch.length === 0) {
        this.emptyCycles += 1;
      } else {
        this.emptyCycles = 0;
      }

      await tickScroll(this.scrollContainer);
      const growthSeen = await observeDomGrowth(this.scrollContainer, LOAD_WAIT_MS);
      await sleep(TICK_MS);

      const cardCountAfter = queryCards().length;
      const metricsAfter = getScrollMetrics(this.scrollContainer);
      const progressed =
        growthSeen ||
        cardCountAfter > cardCountBefore ||
        metricsAfter.scrollHeight > metricsBefore.scrollHeight + 10;

      if (progressed) {
        this.stagnantCycles = 0;
      } else if (isNearBottom(this.scrollContainer)) {
        this.stagnantCycles += 1;
      }

      const atEnd = isNearBottom(this.scrollContainer);
      const response = await sendMessage(MESSAGE_TYPES.INDEX_BATCH, {
        items: batch,
        atEnd,
        stagnantCycles: this.stagnantCycles,
        checkpoint: {
          tick: this.ticks,
          scrollTop: metricsAfter.scrollTop,
          scrollHeight: metricsAfter.scrollHeight,
          cardCount: cardCountAfter,
        },
      });

      if (!response?.ok) {
        this.running = false;
        throw new Error(response?.error || "Unknown indexing error");
      }

      if (
        response.data?.status === "completed" ||
        (this.emptyCycles >= MAX_EMPTY_CYCLES && this.stagnantCycles >= MAX_STAGNANT_CYCLES && atEnd)
      ) {
        this.running = false;
        this.paused = false;
        return;
      }

      this.ticks += 1;
    }
    if (!this.paused) {
      this.running = false;
      this.paused = false;
    }
    this.loopPromise = null;
  }
}

if (!window.__LSN_SYNC_ENGINE__) {
  window.__LSN_SYNC_ENGINE__ = new GuidedSyncEngine();
}

function el(id) {
  return document.getElementById(id);
}

function createSidebar() {
  if (document.getElementById("lsn-root")) {
    return;
  }

  const root = document.createElement("aside");
  root.id = "lsn-root";
  root.innerHTML = `
    <button id="lsn-toggle" title="Toggle navigator">Saved Navigator</button>
    <section id="lsn-panel" class="open">
      <header class="lsn-header">
        <h2>Saved Navigator</h2>
        <span id="lsn-status-pill">idle</span>
      </header>
      <p id="lsn-runtime-notice" style="display:none;"></p>
      <div class="lsn-controls">
        <button id="lsn-start">Start Sync</button>
        <button id="lsn-pause">Pause</button>
        <button id="lsn-resume">Resume</button>
      </div>
      <p id="lsn-progress">Indexed: 0</p>
      <div id="lsn-query-zone">
        <input id="lsn-q" placeholder="Search text..." />
        <div class="lsn-filter-grid">
          <input id="lsn-author" placeholder="Author name" />
          <select id="lsn-type">
            <option value="">All types</option>
            <option value="article">Article</option>
            <option value="video">Video</option>
            <option value="document">Document</option>
            <option value="image">Image</option>
            <option value="unknown">Unknown</option>
          </select>
          <input id="lsn-date-from" type="date" />
          <input id="lsn-date-to" type="date" />
          <select id="lsn-month">
            <option value="">Any month</option>
            <option value="1">Jan</option>
            <option value="2">Feb</option>
            <option value="3">Mar</option>
            <option value="4">Apr</option>
            <option value="5">May</option>
            <option value="6">Jun</option>
            <option value="7">Jul</option>
            <option value="8">Aug</option>
            <option value="9">Sep</option>
            <option value="10">Oct</option>
            <option value="11">Nov</option>
            <option value="12">Dec</option>
          </select>
          <select id="lsn-dow">
            <option value="">Any weekday</option>
            <option value="0">Sun</option>
            <option value="1">Mon</option>
            <option value="2">Tue</option>
            <option value="3">Wed</option>
            <option value="4">Thu</option>
            <option value="5">Fri</option>
            <option value="6">Sat</option>
          </select>
          <input id="lsn-dom" type="number" min="1" max="31" placeholder="Day (1-31)" />
        </div>
        <div class="lsn-search-actions">
          <label class="lsn-all-match-row">
            <input id="lsn-all-matches" type="checkbox" />
            Return all matches
          </label>
          <button id="lsn-search">Search</button>
          <button id="lsn-clear">Clear</button>
        </div>
      </div>
      <div id="lsn-results-zone">
        <p class="lsn-results-meta">No results yet.</p>
        <div class="lsn-pagination">
          <button id="lsn-prev" disabled>Prev</button>
          <span id="lsn-page-label">Page 1 / 1</span>
          <button id="lsn-next" disabled>Next</button>
        </div>
        <div id="lsn-results-list"></div>
      </div>
    </section>
  `;
  document.body.appendChild(root);

  el("lsn-toggle")?.addEventListener("click", () => {
    el("lsn-panel")?.classList.toggle("open");
  });
  el("lsn-start")?.addEventListener("click", () => {
    window.__LSN_SYNC_ENGINE__.start({ reset: true });
  });
  el("lsn-pause")?.addEventListener("click", () => {
    window.__LSN_SYNC_ENGINE__.pause();
  });
  el("lsn-resume")?.addEventListener("click", () => {
    window.__LSN_SYNC_ENGINE__.resume();
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
}

function renderSyncStatus(data) {
  const status = data?.status || "idle";
  const indexed = Number(data?.itemsIndexed || 0);
  const batches = Number(data?.batchesSeen || 0);
  const pill = el("lsn-status-pill");
  const progress = el("lsn-progress");
  if (pill) {
    pill.textContent = status;
    pill.dataset.status = status;
  }
  if (progress) {
    progress.textContent = `Indexed: ${indexed} | Batches: ${batches}`;
  }
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
  const dowValue = Number(el("lsn-dow")?.value || -1);
  const domValue = Number(el("lsn-dom")?.value || 0);
  const authorValue = (el("lsn-author")?.value || "").trim();

  return {
    dateFrom: el("lsn-date-from")?.value || "",
    dateTo: el("lsn-date-to")?.value || "",
    months: monthValue > 0 ? [monthValue] : [],
    dayOfWeek: dowValue >= 0 ? [dowValue] : [],
    dayOfMonth: domValue >= 1 && domValue <= 31 ? [domValue] : [],
    authors: authorValue ? [authorValue] : [],
    contentTypes: typeValue ? [typeValue] : [],
  };
}

function renderResults(payload) {
  const list = el("lsn-results-list");
  const meta = document.querySelector(".lsn-results-meta");
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
  pageLabel.textContent = `Page ${page} / ${totalPages}`;
  meta.textContent = `Found ${total} posts`;
  if (Boolean(el("lsn-all-matches")?.checked)) {
    meta.textContent += " | high-volume mode";
  }

  if (results.length === 0) {
    list.innerHTML = "<p class='lsn-empty'>No matches.</p>";
    return;
  }

  list.innerHTML = results
    .map((post) => {
      const author = escapeHtml(post.authorName || "Unknown author");
      const text = escapeHtml((post.contentText || "").slice(0, 190));
      const date = escapeHtml(post.postDate || post.dateLabel || "");
      const type = escapeHtml(post.contentType || "unknown");
      return `
        <article class="lsn-result">
          <div class="lsn-result-top">
            <strong>${author}</strong>
            <span>${type}</span>
          </div>
          <p>${text || "(No text extracted)"}</p>
          <div class="lsn-result-bottom">
            <small>${date}</small>
            <button data-open-id="${post.id}" class="lsn-open">Open</button>
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
  const ids = ["lsn-q", "lsn-author", "lsn-date-from", "lsn-date-to", "lsn-month", "lsn-dow", "lsn-dom", "lsn-type"];
  for (const id of ids) {
    const node = el(id);
    if (!node) continue;
    node.value = "";
  }
  if (el("lsn-all-matches")) {
    el("lsn-all-matches").checked = false;
  }
  performSearch(1);
}

async function pollSyncStatus() {
  if (runtimeInvalidated) {
    return;
  }
  try {
    const response = await sendMessage(MESSAGE_TYPES.SYNC_STATUS, {});
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

function registerMessageListener() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, error: "Invalid message payload" });
      return false;
    }
    if (!message.type) {
      sendResponse({ ok: false, error: "Missing message type" });
      return false;
    }
    if (message.type === MESSAGE_TYPES.SYNC_START) {
      window.__LSN_SYNC_ENGINE__
        .start({ reset: Boolean(message.payload?.reset) })
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          logError("SYNC_START handler", error);
          sendResponse({ ok: false, error: String(error?.message || error) });
        });
      return true;
    }
    if (message.type === MESSAGE_TYPES.SYNC_PAUSE) {
      window.__LSN_SYNC_ENGINE__
        .pause()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          logError("SYNC_PAUSE handler", error);
          sendResponse({ ok: false, error: String(error?.message || error) });
        });
      return true;
    }
    if (message.type === MESSAGE_TYPES.SYNC_RESUME) {
      window.__LSN_SYNC_ENGINE__
        .resume()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          logError("SYNC_RESUME handler", error);
          sendResponse({ ok: false, error: String(error?.message || error) });
        });
      return true;
    }

    sendResponse({ ok: false, error: `Unsupported content-script message type: ${String(message.type)}` });
    return false;
  });
}

function bootstrapOnce() {
  if (window.__LSN_BOOTSTRAPPED__) {
    return;
  }
  window.__LSN_BOOTSTRAPPED__ = true;
  createSidebar();
  pollSyncStatus();

  window.addEventListener("error", (event) => {
    logError("window error", event?.error || event?.message || "unknown error");
  });

  window.addEventListener("unhandledrejection", (event) => {
    logError("unhandled rejection", event?.reason || "unknown rejection");
  });

  registerMessageListener();
}

bootstrapOnce();
