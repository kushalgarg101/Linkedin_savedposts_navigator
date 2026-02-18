import {
  MESSAGE_TYPES,
  SYNC_STATUSES,
  createDefaultSyncState,
  isValidMessage,
  ok,
  err,
} from "../shared/messages.js";
import {
  loadSyncState,
  saveSyncState,
  upsertPosts,
  searchPosts,
  getPostById,
  listAuthorSuggestions,
  clearPosts,
} from "../shared/db.js";

let syncState = createDefaultSyncState();
const ALLOWED_SENDER_RE = /^https:\/\/(?:www\.)?linkedin\.com\/my-items\/saved-posts(?:\/|\?|#|$)/i;
const SAVED_POSTS_URL = "https://www.linkedin.com/my-items/saved-posts/";
const SAVED_POSTS_PATTERNS = [
  "https://www.linkedin.com/my-items/saved-posts",
  "https://www.linkedin.com/my-items/saved-posts/",
  "https://www.linkedin.com/my-items/saved-posts/*",
];
const SAFE_ATTACHMENT_HOSTS = new Set([
  "www.linkedin.com",
  "linkedin.com",
  "media.licdn.com",
]);
const MAX_QUERY_LENGTH = 500;
const MAX_FILTER_LIST = 20;

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function normalizeText(value, maxLen = MAX_QUERY_LENGTH) {
  return String(value || "").trim().slice(0, maxLen);
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeFilterNumberList(values, { min, max }) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const raw of values) {
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const v = Math.floor(n);
    if (v < min || v > max) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length >= MAX_FILTER_LIST) break;
  }
  return out;
}

function normalizeFilterStringList(values, maxLen = 60) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const raw of values) {
    const t = String(raw || "").trim().slice(0, maxLen);
    if (!t) continue;
    const key = t.toLowerCase();
    if (!out.some((x) => x.toLowerCase() === key)) {
      out.push(t);
    }
    if (out.length >= MAX_FILTER_LIST) break;
  }
  return out;
}

function sanitizeSearchFilters(filters) {
  const src = filters && typeof filters === "object" ? filters : {};
  return {
    dateFrom: normalizeText(src.dateFrom, 20),
    dateTo: normalizeText(src.dateTo, 20),
    months: normalizeFilterNumberList(src.months, { min: 1, max: 12 }),
    dayOfWeek: normalizeFilterNumberList(src.dayOfWeek, { min: 0, max: 6 }),
    dayOfMonth: normalizeFilterNumberList(src.dayOfMonth, { min: 1, max: 31 }),
    authors: normalizeFilterStringList(src.authors, 80),
    contentTypes: normalizeFilterStringList(src.contentTypes, 20).map((x) => x.toLowerCase()),
  };
}

function isAllowedPostUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== "www.linkedin.com" && parsed.hostname !== "linkedin.com") return false;
    return parsed.pathname.includes("/feed/update/") || parsed.pathname.includes("/posts/");
  } catch {
    return false;
  }
}

function isAllowedAttachmentUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:") return false;
    return SAFE_ATTACHMENT_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isAllowedSender(sender) {
  const senderUrl = String(sender?.url || "");
  return ALLOWED_SENDER_RE.test(senderUrl);
}

function isSavedPostsUrl(url) {
  return ALLOWED_SENDER_RE.test(String(url || ""));
}

function waitForTabReady(tabId, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId !== tabId) return;
      if (info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === "complete") {
        finish();
      }
    }).catch(() => {
      finish();
    });
    timer = setTimeout(finish, timeoutMs);
  });
}

function isStaleContextError(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    msg.includes("extension context invalidated") ||
    msg.includes("receiving end does not exist") ||
    msg.includes("could not establish connection") ||
    msg.includes("message port closed")
  );
}

async function hydrateSyncState() {
  try {
    const data = await loadSyncState();
    if (data) {
      syncState = { ...createDefaultSyncState(), ...data };
    }
  } catch (e) {
    syncState = { ...createDefaultSyncState(), status: SYNC_STATUSES.ERROR, lastError: String(e) };
  }
}

async function persistSyncState() {
  syncState.updatedAt = Date.now();
  await saveSyncState(syncState);
}

async function setState(patch) {
  syncState = { ...syncState, ...patch, updatedAt: Date.now() };
  await persistSyncState();
  return syncState;
}

async function handleIndexBatch(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const emptyBatch = items.length === 0;
  const atEnd = Boolean(payload?.atEnd);
  const nextEmptyCycles = emptyBatch ? syncState.emptyCycles + 1 : 0;
  const shouldComplete = atEnd && !Boolean(payload?.inFlight);
  let nextStatus = syncState.status;
  if (shouldComplete) {
    nextStatus = SYNC_STATUSES.COMPLETED;
  } else if (items.length > 0) {
    nextStatus = SYNC_STATUSES.RUNNING;
  }
  const stats = await upsertPosts(items);

  return ok(
    await setState({
      itemsIndexed: stats.total,
      newItems: Number(payload?.newItems || 0),
      pagesFetched: Number(payload?.pagesFetched || syncState.pagesFetched || 0),
      batchesSeen: syncState.batchesSeen + 1,
      emptyCycles: nextEmptyCycles,
      status: nextStatus,
      mode: String(payload?.mode || syncState.mode || "idle"),
      inFlight: Boolean(payload?.inFlight),
      cursor: payload?.cursor ?? syncState.cursor ?? null,
      lastCheckpoint: payload?.checkpoint || null,
      atEnd,
    }),
  );
}

async function handleSyncProgress(payload) {
  const allowedStatuses = new Set([SYNC_STATUSES.IDLE, SYNC_STATUSES.RUNNING, SYNC_STATUSES.COMPLETED, SYNC_STATUSES.ERROR]);
  const allowedModes = new Set(["idle", "full", "incremental"]);
  const patch = {
    status: normalizeEnum(payload?.status ?? syncState.status, allowedStatuses, SYNC_STATUSES.IDLE),
    mode: normalizeEnum(payload?.mode ?? syncState.mode, allowedModes, "idle"),
    inFlight: payload?.inFlight == null ? Boolean(syncState.inFlight) : Boolean(payload.inFlight),
    cursor: payload?.cursor ?? syncState.cursor ?? null,
    pagesFetched:
      payload?.pagesFetched == null
        ? Number(syncState.pagesFetched || 0)
        : clampInt(payload.pagesFetched, 0, 2_000_000, Number(syncState.pagesFetched || 0)),
    newItems:
      payload?.newItems == null
        ? Number(syncState.newItems || 0)
        : clampInt(payload.newItems, 0, 2_000_000, Number(syncState.newItems || 0)),
    lastSeenNewestPostId: normalizeText(payload?.lastSeenNewestPostId || syncState.lastSeenNewestPostId || null, 120),
    lastError: payload?.lastError ?? syncState.lastError ?? null,
  };
  if (payload?.completedFullSync) {
    patch.completedFullSync = true;
    patch.lastFullSyncAt = Date.now();
  }
  if (payload?.checkedIncremental) {
    patch.lastQuickCheckAt = Date.now();
  }
  return ok(await setState(patch));
}

async function handleRestartFullSync() {
  // Clear all existing posts to force fresh extraction
  await clearPosts();
  return ok(
    await setState({
      mode: "full",
      status: SYNC_STATUSES.IDLE,
      inFlight: false,
      cursor: null,
      pagesFetched: 0,
      newItems: 0,
      lastError: null,
      completedFullSync: false,
    }),
  );
}

async function handleStartFullSync(payload) {
  const resume = payload?.resume !== false;
  return ok(
    await setState({
      mode: "full",
      status: SYNC_STATUSES.RUNNING,
      inFlight: true,
      lastError: null,
      ...(resume
        ? {}
        : {
          cursor: 0,
          pagesFetched: 0,
          newItems: 0,
          completedFullSync: false,
          lastCheckpoint: null,
        }),
    }),
  );
}

async function handleRunIncrementalCheck() {
  return ok(
    await setState({
      mode: "incremental",
      status: SYNC_STATUSES.RUNNING,
      inFlight: true,
      lastError: null,
    }),
  );
}

function handleSyncStatus() {
  return ok(syncState);
}

async function handleSearchQuery(payload) {
  const safeFilters = sanitizeSearchFilters(payload?.filters);
  const result = await searchPosts({
    queryText: normalizeText(payload?.queryText || "", MAX_QUERY_LENGTH),
    filters: safeFilters,
    page: clampInt(payload?.page, 1, 1_000_000, 1),
    pageSize: clampInt(payload?.pageSize ?? 30, 0, 500, 30),
  });
  return ok(result);
}

async function handleAuthorSuggestions(payload) {
  const rows = await listAuthorSuggestions({
    query: normalizeText(payload?.query || "", 80),
    limit: clampInt(payload?.limit, 1, 100, 20),
  });
  return ok({ authors: rows });
}

async function handleOpenPost(payload) {
  const postId = String(payload?.postId || "");
  if (!postId) {
    return err("postId is required");
  }
  const post = await getPostById(postId);
  if (!post?.postUrl) {
    return err("Post URL not found");
  }
  if (!isAllowedPostUrl(post.postUrl)) {
    return err("Blocked unsafe post URL");
  }
  await chrome.tabs.create({ url: post.postUrl });
  return ok({ opened: true });
}

async function handleOpenAttachment(payload) {
  const postId = String(payload?.postId || "");
  if (!postId) {
    return err("postId is required");
  }
  const post = await getPostById(postId);
  const attachmentUrl = String(post?.attachmentUrl || "");
  if (!attachmentUrl) {
    return err("Attachment URL not found");
  }
  if (!isAllowedAttachmentUrl(attachmentUrl)) {
    return err("Blocked unsafe attachment URL");
  }
  await chrome.tabs.create({ url: attachmentUrl });
  return ok({ opened: true });
}

async function handleOpenProfile(payload) {
  const postId = String(payload?.postId || "");
  if (!postId) {
    return err("postId is required");
  }
  const post = await getPostById(postId);
  const profileUrl = String(post?.profileUrl || "");
  if (!profileUrl) {
    return err("Profile URL not found");
  }
  if (!profileUrl.startsWith("https://www.linkedin.com/in/")) {
    return err("Invalid profile URL");
  }
  await chrome.tabs.create({ url: profileUrl });
  return ok({ opened: true });
}

async function handleMessage(message) {
  if (!isValidMessage(message)) {
    return err("Invalid message shape");
  }
  switch (message.type) {
    case MESSAGE_TYPES.SYNC_STATUS:
      return handleSyncStatus();
    case MESSAGE_TYPES.INDEX_BATCH:
      return handleIndexBatch(message.payload);
    case MESSAGE_TYPES.SYNC_PROGRESS:
      return handleSyncProgress(message.payload);
    case MESSAGE_TYPES.START_FULL_SYNC:
      return handleStartFullSync(message.payload);
    case MESSAGE_TYPES.RESTART_FULL_SYNC:
      return handleRestartFullSync();
    case MESSAGE_TYPES.RUN_INCREMENTAL_CHECK:
      return handleRunIncrementalCheck();
    case MESSAGE_TYPES.SEARCH_QUERY:
      return handleSearchQuery(message.payload);
    case MESSAGE_TYPES.AUTHOR_SUGGESTIONS:
      return handleAuthorSuggestions(message.payload);
    case MESSAGE_TYPES.OPEN_POST:
      return handleOpenPost(message.payload);
    case MESSAGE_TYPES.OPEN_ATTACHMENT:
      return handleOpenAttachment(message.payload);
    case MESSAGE_TYPES.OPEN_PROFILE:
      return handleOpenProfile(message.payload);
    default:
      return err("Unsupported message type");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  hydrateSyncState();
});

chrome.runtime.onStartup.addListener(() => {
  hydrateSyncState();
});

hydrateSyncState();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isAllowedSender(_sender)) {
    sendResponse(err("Sender not allowed"));
    return false;
  }
  handleMessage(message)
    .then(sendResponse)
    .catch((e) => {
      const failure = { ...syncState, status: SYNC_STATUSES.ERROR, lastError: String(e) };
      syncState = failure;
      persistSyncState().finally(() => sendResponse(err(e?.message || e)));
    });
  return true;
});

chrome.action.onClicked.addListener(async (tab) => {
  const tabId = Number(tab?.id || 0);
  const tabUrl = String(tab?.url || "");

  let targetTab = null;
  if (tabId > 0 && isSavedPostsUrl(tabUrl)) {
    targetTab = tab;
  } else {
    const existing = await chrome.tabs.query({ url: SAVED_POSTS_PATTERNS });
    if (existing.length > 0) {
      targetTab = existing[0];
      if (targetTab?.id) {
        await chrome.tabs.update(targetTab.id, { active: true });
        await waitForTabReady(targetTab.id);
      }
    }
  }

  if (!targetTab) {
    targetTab = await chrome.tabs.create({ url: SAVED_POSTS_URL });
    if (targetTab?.id) {
      await waitForTabReady(targetTab.id);
    }
  }

  const targetTabId = Number(targetTab?.id || 0);
  if (targetTabId <= 0) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(targetTabId, { type: "LSN_SHOW_PANEL" });
    return;
  } catch (error) {
    if (isStaleContextError(error)) {
      try {
        await chrome.tabs.reload(targetTabId);
        await waitForTabReady(targetTabId);
      } catch {
        // Continue to reinjection path below.
      }
    }
    // Content script not ready; attempt injection below.
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: targetTabId },
      files: ["src/sidebar/sidebar.css"],
    });
  } catch {
    // CSS may already be present.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      files: ["src/content/linkedin-saved.js"],
    });
  } catch {
    // Script may already be present.
  }

  try {
    await chrome.tabs.sendMessage(targetTabId, { type: "LSN_SHOW_PANEL" });
  } catch {
    if (!isSavedPostsUrl(String(targetTab?.url || ""))) {
      await chrome.tabs.update(targetTabId, { url: SAVED_POSTS_URL });
    }
  }
});
