export const MESSAGE_TYPES = Object.freeze({
  SYNC_START: "SYNC_START",
  SYNC_PAUSE: "SYNC_PAUSE",
  SYNC_RESUME: "SYNC_RESUME",
  SYNC_STATUS: "SYNC_STATUS",
  INDEX_BATCH: "INDEX_BATCH",
  SEARCH_QUERY: "SEARCH_QUERY",
  OPEN_POST: "OPEN_POST",
  HEALTH_STATS: "HEALTH_STATS",
});

export const SYNC_STATUSES = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  ERROR: "error",
});

export function createDefaultSyncState() {
  return {
    status: SYNC_STATUSES.IDLE,
    itemsIndexed: 0,
    batchesSeen: 0,
    emptyCycles: 0,
    sessionId: null,
    startedAt: null,
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
