import {
  MESSAGE_TYPES,
  SYNC_STATUSES,
  createDefaultSyncState,
  isValidMessage,
  ok,
  err,
} from "../shared/messages.js";
import { loadSyncState, saveSyncState, upsertPosts, searchPosts, getPostById } from "../shared/db.js";

let syncState = createDefaultSyncState();
const ALLOWED_SENDER_RE = /^https:\/\/www\.linkedin\.com\/my-items\/saved-posts(?:\/|\?|#|$)/i;

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

function isAllowedSender(sender) {
  const senderUrl = String(sender?.url || "");
  return ALLOWED_SENDER_RE.test(senderUrl);
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

function newSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function handleSyncStart(payload) {
  const resetCounter = Boolean(payload?.reset);
  const next = {
    status: SYNC_STATUSES.RUNNING,
    sessionId: newSessionId(),
    startedAt: Date.now(),
    lastError: null,
    emptyCycles: 0,
  };
  if (resetCounter) {
    next.itemsIndexed = 0;
    next.batchesSeen = 0;
  }
  return ok(await setState(next));
}

async function handleSyncPause() {
  if (syncState.status !== SYNC_STATUSES.RUNNING) {
    return err("Sync is not running");
  }
  return ok(await setState({ status: SYNC_STATUSES.PAUSED }));
}

async function handleSyncResume() {
  if (syncState.status !== SYNC_STATUSES.PAUSED) {
    return err("Sync is not paused");
  }
  return ok(await setState({ status: SYNC_STATUSES.RUNNING, lastError: null }));
}

async function handleIndexBatch(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const emptyBatch = items.length === 0;
  const atEnd = Boolean(payload?.atEnd);
  const stagnantCycles = Number(payload?.stagnantCycles || 0);
  const nextEmptyCycles = emptyBatch ? syncState.emptyCycles + 1 : 0;
  const shouldComplete = atEnd && nextEmptyCycles >= 3 && stagnantCycles >= 3;
  const nextStatus = shouldComplete ? SYNC_STATUSES.COMPLETED : syncState.status;
  const stats = await upsertPosts(items);

  return ok(
    await setState({
      itemsIndexed: stats.total,
      batchesSeen: syncState.batchesSeen + 1,
      emptyCycles: nextEmptyCycles,
      status: nextStatus,
      lastCheckpoint: payload?.checkpoint || null,
      atEnd,
      stagnantCycles,
    }),
  );
}

function handleSyncStatus() {
  return ok(syncState);
}

async function handleSearchQuery(payload) {
  const result = await searchPosts({
    queryText: payload?.queryText || "",
    filters: payload?.filters || {},
    page: Number(payload?.page || 1),
    pageSize: Number(payload?.pageSize ?? 30),
  });
  return ok(result);
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

async function handleMessage(message) {
  if (!isValidMessage(message)) {
    return err("Invalid message shape");
  }
  switch (message.type) {
    case MESSAGE_TYPES.SYNC_START:
      return handleSyncStart(message.payload);
    case MESSAGE_TYPES.SYNC_PAUSE:
      return handleSyncPause();
    case MESSAGE_TYPES.SYNC_RESUME:
      return handleSyncResume();
    case MESSAGE_TYPES.SYNC_STATUS:
      return handleSyncStatus();
    case MESSAGE_TYPES.INDEX_BATCH:
      return handleIndexBatch(message.payload);
    case MESSAGE_TYPES.SEARCH_QUERY:
      return handleSearchQuery(message.payload);
    case MESSAGE_TYPES.OPEN_POST:
      return handleOpenPost(message.payload);
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
