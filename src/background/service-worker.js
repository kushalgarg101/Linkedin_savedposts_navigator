import {
  MESSAGE_TYPES,
  SYNC_STATUSES,
  createDefaultSyncState,
  isValidMessage,
  ok,
  err,
} from "../shared/messages.js";

const STORAGE_KEYS = Object.freeze({
  SYNC_STATE: "lsn_sync_state",
});

let syncState = createDefaultSyncState();

async function loadSyncState() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.SYNC_STATE);
    if (data?.[STORAGE_KEYS.SYNC_STATE]) {
      syncState = { ...createDefaultSyncState(), ...data[STORAGE_KEYS.SYNC_STATE] };
    }
  } catch (e) {
    syncState = { ...createDefaultSyncState(), status: SYNC_STATUSES.ERROR, lastError: String(e) };
  }
}

async function persistSyncState() {
  syncState.updatedAt = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_STATE]: syncState });
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
  const nextEmptyCycles = emptyBatch ? syncState.emptyCycles + 1 : 0;
  const nextStatus = nextEmptyCycles >= 4 ? SYNC_STATUSES.COMPLETED : syncState.status;

  return ok(
    await setState({
      itemsIndexed: syncState.itemsIndexed + items.length,
      batchesSeen: syncState.batchesSeen + 1,
      emptyCycles: nextEmptyCycles,
      status: nextStatus,
    }),
  );
}

function handleSyncStatus() {
  return ok(syncState);
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
      return err("SEARCH_QUERY not implemented yet");
    case MESSAGE_TYPES.OPEN_POST:
      return err("OPEN_POST not implemented yet");
    default:
      return err("Unsupported message type");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  loadSyncState();
});

chrome.runtime.onStartup.addListener(() => {
  loadSyncState();
});

loadSyncState();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((e) => {
      const failure = { ...syncState, status: SYNC_STATUSES.ERROR, lastError: String(e) };
      syncState = failure;
      persistSyncState().finally(() => sendResponse(err(e?.message || e)));
    });
  return true;
});
