import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ChatMessage } from "@novel-master/core/chat";
import { seqRangeFromFloors } from "../src/message/floor.js";

function msg(seq: number): ChatMessage {
  return {
    id: `id-${seq}`,
    sessionId: "s1",
    seq,
    role: "user",
    content: { blocks: [{ type: "text", text: String(seq) }] },
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

describe("seqRangeFromFloors", () => {
  it("maps floors to seq when seq has gaps after delete", () => {
    const list = [msg(1), msg(3), msg(7)];
    const range = seqRangeFromFloors(list, 2, 3);
    assert.equal(range.fromSeq, 3);
    assert.equal(range.toSeq, 7);
  });

  it("rejects from-floor > to-floor", () => {
    assert.throws(
      () => seqRangeFromFloors([msg(1)], 2, 1),
      /from-floor/,
    );
  });
});
