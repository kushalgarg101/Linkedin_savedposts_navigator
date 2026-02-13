function hashString(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(16);
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function classifyContentType(text) {
  const t = text.toLowerCase();
  if (t.includes("video")) return "video";
  if (t.includes("document")) return "document";
  if (t.includes("article")) return "article";
  if (t.includes("image") || t.includes("photo")) return "image";
  return "unknown";
}

function parseDateLoose(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function buildPostId(postUrl, authorName, textSnippet, postDate) {
  const base = [postUrl || "", authorName || "", textSnippet || "", postDate || ""].join("|");
  return `lsn_${hashString(base)}`;
}

export function normalizeSavedPost(raw) {
  const postUrl = normalizeWhitespace(raw?.postUrl || "");
  const authorName = normalizeWhitespace(raw?.authorName || "");
  const contentText = normalizeWhitespace(raw?.contentText || "");
  const dateLabel = normalizeWhitespace(raw?.dateLabel || "");
  const postDate = parseDateLoose(raw?.postDate || dateLabel);
  const contentType = classifyContentType(contentText);
  const id = buildPostId(postUrl, authorName, contentText.slice(0, 120), postDate || dateLabel);

  return {
    id,
    postUrl,
    authorName,
    contentText,
    contentType,
    dateLabel,
    postDate,
    savedAt: null,
    indexedAt: new Date().toISOString(),
    rawMeta: {
      source: "linkedin_saved_posts",
    },
  };
}
