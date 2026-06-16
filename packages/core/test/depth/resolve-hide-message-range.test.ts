/**
 * resolve-hide-message-range 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import { resolveHideMessageRange } from "../../src/domain/depth/logic/resolve-hide-message-range.js";
import { messageIdsInSlice } from "../../src/domain/depth/logic/depth-slice.js";
import { listVisibleForDepth } from "../../src/domain/depth/logic/depth-from-tail.js";

function makeMsg(
  id: string,
  seq: number,
  role: string,
): ChatMessage {
  return {
    id,
    sessionId: "s1",
    seq,
    role,
    content: { blocks: [{ type: "text", text: id }] },
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

describe("resolveHideMessageRange", () => {
  const all = [
    makeMsg("m1", 1, "assistant"),
    makeMsg("m2", 2, "user"),
    makeMsg("m3", 3, "assistant"),
    makeMsg("m4", 4, "user"),
    makeMsg("m5", 5, "assistant"),
    makeMsg("m6", 6, "user"),
    makeMsg("m7", 7, "assistant"),
  ];
  const visible = listVisibleForDepth(all);

  it("startDepth=6 且 depth6 为 assistant 时从该 seq 起 hide", () => {
    const slice = { startDepth: 6 };
    const ids = messageIdsInSlice(visible, slice);
    const range = resolveHideMessageRange(visible, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 1);
    assert.equal(range.toSeq, 1);
  });

  it("startDepth=6 且 depth6 为 user 时锚定更深 assistant", () => {
    const withUserAt6 = [
      makeMsg("m1", 1, "user"),
      makeMsg("m2", 2, "assistant"),
      makeMsg("m3", 3, "user"),
      makeMsg("m4", 4, "user"),
      makeMsg("m5", 5, "assistant"),
      makeMsg("m6", 6, "assistant"),
      makeMsg("m7", 7, "assistant"),
      makeMsg("m8", 8, "assistant"),
      makeMsg("m9", 9, "assistant"),
      makeMsg("m10", 10, "assistant"),
    ];
    const vis = listVisibleForDepth(withUserAt6);
    const slice = { startDepth: 6 };
    const ids = messageIdsInSlice(vis, slice);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 2);
    assert.equal(range.toSeq, 4);
  });

  it("范围内无 assistant 时不 hide", () => {
    const onlyUsers = [
      makeMsg("u1", 1, "user"),
      makeMsg("u2", 2, "user"),
      makeMsg("u3", 3, "user"),
    ];
    const vis = listVisibleForDepth(onlyUsers);
    const slice = { startDepth: 1 };
    const ids = messageIdsInSlice(vis, slice);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.equal(range, null);
  });

  it("有 endDepth 时仍用 slice 内 min~max seq", () => {
    const slice = { startDepth: 2, endDepth: 4 };
    const ids = messageIdsInSlice(visible, slice);
    const range = resolveHideMessageRange(visible, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 3);
    assert.equal(range.toSeq, 5);
  });
});
