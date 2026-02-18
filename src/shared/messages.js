export const MESSAGE_TYPES = Object.freeze({
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

export const SYNC_STATUSES = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  COMPLETED: "completed",
  ERROR: "error",
});

export function createDefaultSyncState() {
  return {
    status: SYNC_STATUSES.IDLE,
    mode: "idle",
    itemsIndexed: 0,
    newItems: 0,
    pagesFetched: 0,
    batchesSeen: 0,
    emptyCycles: 0,
    cursor: null,
    inFlight: false,
    completedFullSync: false,
    lastQuickCheckAt: null,
    lastFullSyncAt: null,
    lastSeenNewestPostId: null,
    updatedAt: Date.now(),
    lastError: null,
  };
}

export function isValidMessage(raw) {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  if (typeof raw.type !== "string") {
    return false;
  }
  return Object.values(MESSAGE_TYPES).includes(raw.type);
}

export function ok(data = null) {
  return { ok: true, data };
}

export function err(message) {
  return { ok: false, error: String(message || "Unknown error") };
}
