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
  const t = String(text || "").toLowerCase();
  if (t.includes("video")) return "video";
  if (t.includes("document")) return "document";
  if (t.includes("article")) return "article";
  if (t.includes("image") || t.includes("photo")) return "image";
  return "unknown";
}

function addMonths(date, months) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

function parseRelativeDateLoose(value) {
  const raw = normalizeWhitespace(value || "").toLowerCase();
  if (!raw) return null;
  const match = raw.match(/\b(\d+)\s*(m|mo|w|d|h|hr|y|yr)\b/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const now = new Date();

  if (unit === "m") return new Date(now.getTime() - amount * 60 * 1000).toISOString();
  if (unit === "h" || unit === "hr") return new Date(now.getTime() - amount * 60 * 60 * 1000).toISOString();
  if (unit === "d") return new Date(now.getTime() - amount * 24 * 60 * 60 * 1000).toISOString();
  if (unit === "w") return new Date(now.getTime() - amount * 7 * 24 * 60 * 60 * 1000).toISOString();
  if (unit === "mo") return addMonths(now, -amount).toISOString();
  if (unit === "y" || unit === "yr") return addMonths(now, -amount * 12).toISOString();
  return null;
}

function parseDateLoose(value) {
  if (!value) return null;
  const relative = parseRelativeDateLoose(value);
  if (relative) return relative;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function buildPostId(postUrl, authorName, textSnippet, postDate) {
  const base = postUrl || [authorName || "", textSnippet || "", postDate || ""].join("|");
  return `lsn_${hashString(base)}`;
}

export function normalizeSavedPost(raw) {
  const postUrl = normalizeWhitespace(raw?.postUrl || "");
  const authorName = normalizeWhitespace(raw?.authorName || "");
  const contentText = normalizeWhitespace(raw?.contentText || "");
  const dateLabel = normalizeWhitespace(raw?.dateLabel || "");
  const postDate = parseDateLoose(raw?.postDate || dateLabel);
  const contentType = normalizeWhitespace(raw?.contentType || "") || classifyContentType(contentText);
  const attachmentUrl = normalizeWhitespace(raw?.attachmentUrl || "");
  const attachmentTitle = normalizeWhitespace(raw?.attachmentTitle || "");
  const attachmentType = normalizeWhitespace(raw?.attachmentType || "");
  const attachmentPreviewUrl = normalizeWhitespace(raw?.attachmentPreviewUrl || "");
  const id = buildPostId(postUrl, authorName, contentText.slice(0, 120), postDate || dateLabel);

  return {
    id,
    postUrl,
    authorName,
    contentText,
    contentType,
    dateLabel,
    postDate,
    attachmentUrl,
    attachmentTitle,
    attachmentType,
    attachmentPreviewUrl,
    savedAt: null,
    indexedAt: new Date().toISOString(),
    rawMeta: {
      source: "linkedin_saved_posts",
    },
  };
}
