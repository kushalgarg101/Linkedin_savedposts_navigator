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
  const postDay = d.toISOString().slice(0, 10);
  if (dateFrom && postDay < dateFrom) return false;
  if (dateTo && postDay > dateTo) return false;
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

export function postMatches(post, queryText = "", filters = {}) {
  return (
    includesText(post, queryText) &&
    inDateRange(post, filters.dateFrom, filters.dateTo) &&
    inMonth(post, filters.months) &&
    inDayOfMonth(post, filters.dayOfMonth) &&
    inDayOfWeek(post, filters.dayOfWeek) &&
    inAuthors(post, filters.authors) &&
    inTypes(post, filters.contentTypes)
  );
}

export function sortRecentFirst(a, b) {
  const ap = Date.parse(a.postDate || a.indexedAt || "");
  const bp = Date.parse(b.postDate || b.indexedAt || "");
  if (Number.isNaN(ap) && Number.isNaN(bp)) return 0;
  if (Number.isNaN(ap)) return 1;
  if (Number.isNaN(bp)) return -1;
  return bp - ap;
}
