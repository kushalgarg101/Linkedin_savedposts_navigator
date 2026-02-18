import test from "node:test";
import assert from "node:assert/strict";
import { MESSAGE_TYPES, createDefaultSyncState, isValidMessage } from "../src/shared/messages.js";

test("isValidMessage accepts new sync message types", () => {
  assert.equal(isValidMessage({ type: MESSAGE_TYPES.SYNC_PROGRESS }), true);
  assert.equal(isValidMessage({ type: MESSAGE_TYPES.START_FULL_SYNC }), true);
  assert.equal(isValidMessage({ type: MESSAGE_TYPES.RESTART_FULL_SYNC }), true);
  assert.equal(isValidMessage({ type: MESSAGE_TYPES.RUN_INCREMENTAL_CHECK }), true);
});

test("createDefaultSyncState includes resumable sync metadata", () => {
  const state = createDefaultSyncState();
  assert.equal(state.mode, "idle");
  assert.equal(state.inFlight, false);
  assert.equal(state.completedFullSync, false);
  assert.equal(state.cursor, null);
  assert.equal(state.newItems, 0);
  assert.equal(state.pagesFetched, 0);
});
