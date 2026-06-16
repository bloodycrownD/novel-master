import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import {
  listVisibleSorted,
  visibleFloorByMessageId,
} from "../../src/domain/chat/logic/message-visible-floor.js";

function msg(
  id: string,
  seq: number,
  hidden: boolean,
): ChatMessage {
  return {
    id,
    sessionId: "s1",
    seq,
    role: "user",
    content: textBlocks(id),
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden,
  };
}

describe("message-visible-floor", () => {
  it("listVisibleSorted excludes hidden", () => {
    const all = [msg("a", 1, false), msg("b", 2, true), msg("c", 3, false)];
    const visible = listVisibleSorted(all);
    assert.equal(visible.length, 2);
    assert.deepEqual(visible.map((m) => m.id), ["a", "c"]);
  });

  it("visibleFloorByMessageId assigns 1-based floors to visible only", () => {
    const all = [msg("a", 1, false), msg("b", 2, true), msg("c", 3, false)];
    const floors = visibleFloorByMessageId(all);
    assert.equal(floors.get("a"), 1);
    assert.equal(floors.get("b"), undefined);
    assert.equal(floors.get("c"), 2);
  });
});
