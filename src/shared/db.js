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

function parseIso(value) {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

function includesText(post, queryText) {
  if (!queryText) return true;
  const q = queryText.toLowerCase();
  return (
    String(post.contentText || "").toLowerCase().includes(q) ||
    String(post.authorName || "").toLowerCase().includes(q) ||
    String(post.postUrl || "").toLowerCase().includes(q)
  );
}

function inDateRange(post, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return true;
  const d = parseIso(post.postDate);
  if (!d) return false;
  if (dateFrom && d < new Date(dateFrom)) return false;
  if (dateTo && d > new Date(dateTo)) return false;
  return true;
}

function inMonth(post, months) {
  if (!Array.isArray(months) || months.length === 0) return true;
  const d = parseIso(post.postDate);
  if (!d) return false;
  return months.includes(d.getUTCMonth() + 1);
}

function inDayOfMonth(post, days) {
  if (!Array.isArray(days) || days.length === 0) return true;
  const d = parseIso(post.postDate);
  if (!d) return false;
  return days.includes(d.getUTCDate());
}

function inDayOfWeek(post, days) {
  if (!Array.isArray(days) || days.length === 0) return true;
  const d = parseIso(post.postDate);
  if (!d) return false;
  return days.includes(d.getUTCDay());
}

function inAuthors(post, authors) {
  if (!Array.isArray(authors) || authors.length === 0) return true;
  return authors.some((author) => String(post.authorName || "").toLowerCase() === String(author || "").toLowerCase());
}

function inTypes(post, contentTypes) {
  if (!Array.isArray(contentTypes) || contentTypes.length === 0) return true;
  return contentTypes.includes(post.contentType || "unknown");
}

function sortRecentFirst(a, b) {
  const ap = Date.parse(a.postDate || a.indexedAt || "");
  const bp = Date.parse(b.postDate || b.indexedAt || "");
  if (Number.isNaN(ap) && Number.isNaN(bp)) return 0;
  if (Number.isNaN(ap)) return 1;
  if (Number.isNaN(bp)) return -1;
  return bp - ap;
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
    .filter((post) => includesText(post, queryText))
    .filter((post) => inDateRange(post, filters.dateFrom, filters.dateTo))
    .filter((post) => inMonth(post, filters.months))
    .filter((post) => inDayOfMonth(post, filters.dayOfMonth))
    .filter((post) => inDayOfWeek(post, filters.dayOfWeek))
    .filter((post) => inAuthors(post, filters.authors))
    .filter((post) => inTypes(post, filters.contentTypes))
    .sort(sortRecentFirst);

  const start = Math.max(0, (page - 1) * pageSize);
  const end = start + pageSize;
  return {
    total: filtered.length,
    page,
    pageSize,
    results: filtered.slice(start, end),
  };
}
