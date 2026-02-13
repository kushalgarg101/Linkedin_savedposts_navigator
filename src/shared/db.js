import { postMatches, sortRecentFirst } from "./filter.js";

const DB_NAME = "linkedin_saved_navigator";
const DB_VERSION = 1;

const STORES = Object.freeze({
  POSTS: "saved_posts",
  SYNC: "sync_state",
});

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
  const tx = db.transaction(STORES.POSTS, "readonly");
  const store = tx.objectStore(STORES.POSTS);
  const all = await requestToPromise(store.getAll());

  const filtered = all
    .filter((post) => postMatches(post, queryText, filters))
    .sort(sortRecentFirst);

  const normalizedPageSize = Number(pageSize);
  const returnAll = !Number.isFinite(normalizedPageSize) || normalizedPageSize <= 0;
  const safePageSize = returnAll ? filtered.length || 1 : Math.min(500, Math.max(1, Math.floor(normalizedPageSize)));
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const start = returnAll ? 0 : (safePage - 1) * safePageSize;
  const end = returnAll ? filtered.length : start + safePageSize;

  return {
    total: filtered.length,
    page: safePage,
    pageSize: returnAll ? filtered.length : safePageSize,
    results: filtered.slice(start, end),
  };
}
