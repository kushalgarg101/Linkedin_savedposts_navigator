import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSavedPost, buildPostId } from "../src/shared/normalize.js";

test("buildPostId is stable for same inputs", () => {
  const id1 = buildPostId("https://linkedin.com/feed/update/1", "A", "B", "2025-01-01");
  const id2 = buildPostId("https://linkedin.com/feed/update/1", "A", "B", "2025-01-01");
  assert.equal(id1, id2);
});

test("normalizeSavedPost trims and classifies content", () => {
  const post = normalizeSavedPost({
    postUrl: " https://linkedin.com/feed/update/2 ",
    authorName: "  Jane Doe ",
    contentText: "  This is a video post  ",
    dateLabel: "2025-06-01",
  });

  assert.equal(post.postUrl, "https://linkedin.com/feed/update/2");
  assert.equal(post.authorName, "Jane Doe");
  assert.equal(post.contentType, "video");
  assert.ok(post.id.startsWith("lsn_"));
});
