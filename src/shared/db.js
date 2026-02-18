import { postMatches } from "./filter.js";

const DB_NAME = "linkedin_saved_navigator";
const DB_VERSION = 2;

const STORES = Object.freeze({
  POSTS: "saved_posts",
  SYNC: "sync_state",
});

const MAX_PAGE_SIZE = 200;
const MAX_ALL_MATCHES_PAGE_SIZE = 500;
let authorCountsCache = null;
let authorCountsCacheDirty = true;
const REQUIRED_POST_INDEXES = Object.freeze([
  ["authorName", "authorName"],
  ["postUrl", "postUrl"],
  ["postDate", "postDate"],
  ["contentType", "contentType"],
  ["indexedAt", "indexedAt"],
]);

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.POSTS)) {
        const posts = db.createObjectStore(STORES.POSTS, { keyPath: "id" });
        ensureRequiredPostIndexes(posts);
      } else if (request.transaction) {
        const posts = request.transaction.objectStore(STORES.POSTS);
        ensureRequiredPostIndexes(posts);
      }
      if (!db.objectStoreNames.contains(STORES.SYNC)) {
        db.createObjectStore(STORES.SYNC, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

let dbPromise = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = openDb();
  }
  return dbPromise;
}

function getStore(db, name, mode = "readonly") {
  return db.transaction(name, mode).objectStore(name);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadSyncState() {
  const db = await getDb();
  const store = getStore(db, STORES.SYNC);
  const record = await requestToPromise(store.get("state"));
  return record?.value || null;
}

export async function saveSyncState(value) {
  const db = await getDb();
  const tx = db.transaction(STORES.SYNC, "readwrite");
  const store = tx.objectStore(STORES.SYNC);
  store.put({ key: "state", value });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function upsertPosts(items) {
  const db = await getDb();
  const tx = db.transaction(STORES.POSTS, "readwrite");
  const store = tx.objectStore(STORES.POSTS);
  const postUrlIndex = store.indexNames.contains("postUrl") ? store.index("postUrl") : null;
  const normalizedItems = dedupeBatchByPostUrl(items);

  for (const item of normalizedItems) {
    if (!item?.id) continue;
    if (postUrlIndex && item.postUrl) {
      await deleteOtherRowsForPostUrl(postUrlIndex, item.postUrl, item.id);
    }
    store.put(item);
  }

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  authorCountsCacheDirty = true;

  const total = await countPosts();
  return { total, batchSize: normalizedItems.length };
}

export async function clearPosts() {
  const db = await getDb();
  const tx = db.transaction(STORES.POSTS, "readwrite");
  const store = tx.objectStore(STORES.POSTS);
  store.clear();
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  authorCountsCacheDirty = true;
}

export async function countPosts() {
  const db = await getDb();
  const store = getStore(db, STORES.POSTS);
  return requestToPromise(store.count());
}

export async function getPostById(id) {
  const db = await getDb();
  const store = getStore(db, STORES.POSTS);
  return requestToPromise(store.get(id));
}

export async function listAuthorSuggestions({ query = "", limit = 20 } = {}) {
  const q = String(query || "").trim().toLowerCase();
  const max = Math.min(100, Math.max(1, Number(limit) || 20));
  if (authorCountsCacheDirty || !authorCountsCache) {
    const db = await getDb();
    const tx = db.transaction(STORES.POSTS, "readonly");
    const store = tx.objectStore(STORES.POSTS);
    const source = store.indexNames.contains("authorName") ? store.index("authorName") : store;
    const buckets = new Map();

    await iterateCursor(source, null, "next", (post) => {
      const author = String(post?.authorName || "").trim();
      if (!author) return;
      const key = author.toLowerCase();
      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        buckets.set(key, { name: author, count: 1 });
      }
    });
    authorCountsCache = Array.from(buckets.values());
    authorCountsCacheDirty = false;
  }

  return (authorCountsCache || [])
    .filter((row) => !q || row.name.toLowerCase().includes(q))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, max);
}

export async function searchPosts({
  queryText = "",
  filters = {},
  page = 1,
  pageSize = 30,
} = {}) {
  const db = await getDb();
  const normalizedPageSize = Number(pageSize);
  const returnAll = !Number.isFinite(normalizedPageSize) || normalizedPageSize <= 0;
  const safePageSize = returnAll
    ? MAX_ALL_MATCHES_PAGE_SIZE
    : Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(normalizedPageSize)));
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const startOffset = (safePage - 1) * safePageSize;
  const endOffsetExclusive = startOffset + safePageSize;

  const tx = db.transaction(STORES.POSTS, "readonly");
  const store = tx.objectStore(STORES.POSTS);
  const cursorConfig = buildCursorConfig(store, filters);
  const direction = "prev";

  const results = [];
  let matchedCount = 0;
  let scannedCount = 0;

  await iterateCursor(cursorConfig.source, cursorConfig.keyRange, direction, (post) => {
    scannedCount += 1;
    if (!postMatches(post, queryText, filters)) {
      return;
    }
    matchedCount += 1;
    if (matchedCount > startOffset && matchedCount <= endOffsetExclusive) {
      results.push(post);
    }
  });

  return {
    total: matchedCount,
    page: safePage,
    pageSize: safePageSize,
    returnAll,
    scannedCount,
    hasMore: matchedCount > safePage * safePageSize,
    results,
  };
}

function normalizeIsoDateOnly(value) {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

function buildDateCursorRange(filters) {
  const fromDateOnly = normalizeIsoDateOnly(filters?.dateFrom);
  const toDateOnly = normalizeIsoDateOnly(filters?.dateTo);

  if (!fromDateOnly && !toDateOnly) {
    return null;
  }

  const lowerBound = fromDateOnly ? `${fromDateOnly}T00:00:00.000Z` : undefined;
  const upperBound = toDateOnly ? `${toDateOnly}T23:59:59.999Z` : undefined;

  if (lowerBound && upperBound) {
    return IDBKeyRange.bound(lowerBound, upperBound);
  }
  if (lowerBound) {
    return IDBKeyRange.lowerBound(lowerBound);
  }
  return IDBKeyRange.upperBound(upperBound);
}

function buildCursorConfig(store, filters) {
  const hasDateFilter = Boolean(filters?.dateFrom) || Boolean(filters?.dateTo);
  if (hasDateFilter && store.indexNames.contains("postDate")) {
    return {
      source: store.index("postDate"),
      keyRange: buildDateCursorRange(filters),
    };
  }
  if (store.indexNames.contains("indexedAt")) {
    return {
      source: store.index("indexedAt"),
      keyRange: null,
    };
  }
  return {
    source: store,
    keyRange: null,
  };
}

function iterateCursor(source, keyRange, direction, onValue) {
  return new Promise((resolve, reject) => {
    const request = source.openCursor(keyRange, direction);
    request.onerror = () => reject(request.error);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve();
        return;
      }
      try {
        onValue(cursor.value);
        cursor.continue();
      } catch (error) {
        reject(error);
      }
    };
  });
}

function dedupeBatchByPostUrl(items) {
  const out = [];
  const seenPostUrls = new Set();
  const seenIds = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.id) continue;
    const postUrl = String(item.postUrl || "").trim();
    if (postUrl) {
      if (seenPostUrls.has(postUrl)) continue;
      seenPostUrls.add(postUrl);
    } else if (seenIds.has(item.id)) {
      continue;
    }
    seenIds.add(item.id);
    out.push(item);
  }
  return out;
}

function deleteOtherRowsForPostUrl(index, postUrl, keepId) {
  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.only(postUrl);
    const request = index.openCursor(range, "next");
    request.onerror = () => reject(request.error);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (cursor.primaryKey !== keepId) {
        cursor.delete();
      }
      cursor.continue();
    };
  });
}

function ensureRequiredPostIndexes(postsStore) {
  for (const [name, keyPath] of REQUIRED_POST_INDEXES) {
    if (!postsStore.indexNames.contains(name)) {
      postsStore.createIndex(name, keyPath, { unique: false });
    }
  }
}
