import { postMatches } from "./filter.js";

const DB_NAME = "linkedin_saved_navigator";
const DB_VERSION = 1;

const STORES = Object.freeze({
  POSTS: "saved_posts",
  SYNC: "sync_state",
});

const MAX_PAGE_SIZE = 200;
const MAX_ALL_MATCHES_PAGE_SIZE = 500;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.POSTS)) {
        const posts = db.createObjectStore(STORES.POSTS, { keyPath: "id" });
        posts.createIndex("authorName", "authorName", { unique: false });
        posts.createIndex("postDate", "postDate", { unique: false });
        posts.createIndex("contentType", "contentType", { unique: false });
        posts.createIndex("indexedAt", "indexedAt", { unique: false });
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

  for (const item of items) {
    if (!item?.id) continue;
    store.put(item);
  }

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  const total = await countPosts();
  return { total, batchSize: items.length };
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

export async function getHealthStats({ sampleSize = 5 } = {}) {
  const db = await getDb();
  const tx = db.transaction(STORES.POSTS, "readonly");
  const store = tx.objectStore(STORES.POSTS);
  const source = store.index("indexedAt");

  let total = 0;
  let withAuthor = 0;
  let withText = 0;
  let withDate = 0;
  const byType = {
    article: 0,
    video: 0,
    document: 0,
    image: 0,
    unknown: 0,
  };
  const samples = [];

  await iterateCursor(source, null, "prev", (post) => {
    total += 1;
    const author = String(post?.authorName || "").trim();
    const text = String(post?.contentText || "").trim();
    const date = String(post?.postDate || "").trim();
    const type = String(post?.contentType || "unknown").toLowerCase();

    if (author) withAuthor += 1;
    if (text) withText += 1;
    if (date) withDate += 1;
    if (Object.prototype.hasOwnProperty.call(byType, type)) {
      byType[type] += 1;
    } else {
      byType.unknown += 1;
    }

    if (samples.length < Math.max(1, Math.floor(sampleSize))) {
      samples.push({
        id: post?.id || "",
        authorName: author,
        contentType: type,
        hasText: Boolean(text),
        hasDate: Boolean(date),
        textSnippet: text.slice(0, 120),
      });
    }
  });

  return {
    total,
    withAuthor,
    withText,
    withDate,
    byType,
    samples,
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
  if (hasDateFilter) {
    return {
      source: store.index("postDate"),
      keyRange: buildDateCursorRange(filters),
    };
  }
  return {
    source: store.index("indexedAt"),
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
