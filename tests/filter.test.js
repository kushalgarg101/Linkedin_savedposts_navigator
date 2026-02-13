import test from "node:test";
import assert from "node:assert/strict";
import { postMatches, sortRecentFirst } from "../src/shared/filter.js";

const sample = {
  id: "p1",
  postUrl: "https://linkedin.com/feed/update/abc",
  authorName: "Alice Doe",
  contentText: "React performance checklist",
  contentType: "article",
  postDate: "2025-09-08T00:00:00.000Z",
  indexedAt: "2025-09-08T00:00:00.000Z",
};

test("postMatches matches query text and author", () => {
  assert.equal(postMatches(sample, "performance", {}), true);
  assert.equal(postMatches(sample, "alice", {}), true);
  assert.equal(postMatches(sample, "golang", {}), false);
});

test("postMatches applies month/day/type filters", () => {
  const filters = {
    months: [9],
    dayOfWeek: [1],
    dayOfMonth: [8],
    authors: ["Alice Doe"],
    contentTypes: ["article"],
  };
  assert.equal(postMatches(sample, "", filters), true);
  assert.equal(postMatches(sample, "", { ...filters, months: [8] }), false);
});

test("postMatches treats dateTo as inclusive end-of-day", () => {
  const timed = { ...sample, postDate: "2025-09-08T18:30:00.000Z" };
  assert.equal(postMatches(timed, "", { dateTo: "2025-09-08" }), true);
  assert.equal(postMatches(timed, "", { dateTo: "2025-09-07" }), false);
});

test("sortRecentFirst orders by most recent date", () => {
  const older = { ...sample, id: "old", postDate: "2024-01-01T00:00:00.000Z" };
  const newer = { ...sample, id: "new", postDate: "2025-12-01T00:00:00.000Z" };
  const sorted = [older, newer].sort(sortRecentFirst);
  assert.equal(sorted[0].id, "new");
});
