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
  "a[href*='linkedin.com']",
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

const TICK_MS = 1250;
const MAX_EMPTY_CYCLES = 4;
const MAX_TICKS = 1500;

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

function queryCards() {
  for (const selector of CARD_SELECTORS) {
    const nodes = document.querySelectorAll(selector);
    if (nodes.length >= 3) {
      return Array.from(nodes);
    }
  }
  return [];
}

function extractVisibleBatch(seenIds) {
  const cards = queryCards();
  const items = [];
  for (const card of cards) {
    const postUrl = linkFromSelectors(card, LINK_SELECTORS);
    const authorName = textFromSelectors(card, AUTHOR_SELECTORS);
    const dateLabel = textFromSelectors(card, DATE_SELECTORS);
    const contentText = textFromSelectors(card, TEXT_SELECTORS) || card.textContent || "";
    if (!postUrl && !contentText.trim()) {
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
  return chrome.runtime.sendMessage({ type, payload });
}

async function tickScroll() {
  window.scrollBy(0, Math.max(420, Math.floor(window.innerHeight * 0.82)));
  await sleep(200);
}

class GuidedSyncEngine {
  constructor() {
    this.running = false;
    this.paused = false;
    this.seenIds = new Set();
    this.emptyCycles = 0;
    this.ticks = 0;
  }

  async start({ reset = false } = {}) {
    if (this.running && !this.paused) {
      return;
    }
    if (reset) {
      this.seenIds.clear();
      this.emptyCycles = 0;
      this.ticks = 0;
    }
    this.running = true;
    this.paused = false;
    await sendMessage(MESSAGE_TYPES.SYNC_START, { reset });
    this.loop().catch((e) => {
      this.running = false;
      this.paused = false;
      console.error("LinkedIn Saved Navigator sync loop failed", e);
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
    if (!this.running || !this.paused) {
      return;
    }
    this.paused = false;
    await sendMessage(MESSAGE_TYPES.SYNC_RESUME, {});
    this.loop();
  }

  async loop() {
    while (this.running && !this.paused && this.ticks < MAX_TICKS) {
      const batch = extractVisibleBatch(this.seenIds);
      const response = await sendMessage(MESSAGE_TYPES.INDEX_BATCH, { items: batch });

      if (batch.length === 0) {
        this.emptyCycles += 1;
      } else {
        this.emptyCycles = 0;
      }

      if (!response?.ok) {
        this.running = false;
        throw new Error(response?.error || "Unknown indexing error");
      }

      if (this.emptyCycles >= MAX_EMPTY_CYCLES || response.data?.status === "completed") {
        this.running = false;
        this.paused = false;
        return;
      }

      this.ticks += 1;
      await tickScroll();
      await sleep(TICK_MS);
    }
    this.running = false;
    this.paused = false;
  }
}

if (!window.__LSN_SYNC_ENGINE__) {
  window.__LSN_SYNC_ENGINE__ = new GuidedSyncEngine();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === MESSAGE_TYPES.SYNC_START) {
    window.__LSN_SYNC_ENGINE__.start({ reset: Boolean(message.payload?.reset) }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === MESSAGE_TYPES.SYNC_PAUSE) {
    window.__LSN_SYNC_ENGINE__.pause().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === MESSAGE_TYPES.SYNC_RESUME) {
    window.__LSN_SYNC_ENGINE__.resume().then(() => sendResponse({ ok: true }));
    return true;
  }
});
