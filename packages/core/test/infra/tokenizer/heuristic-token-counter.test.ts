import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HeuristicTokenCounter } from "../../../src/infra/tokenizer/impl/heuristic-token-counter.js";
import { estimateTokens } from "../../../src/domain/compaction-conditions/logic/token-estimate.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";

function msg(role: ChatMessage["role"], text: string): ChatMessage {
  return {
    id: "1",
    sessionId: "s",
    seq: 1,
    role,
    content: { blocks: [{ type: "text", text }] },
    hidden: false,
    createdAtMs: 0,
  };
}

describe("HeuristicTokenCounter", () => {
  const counter = new HeuristicTokenCounter();

  it("H1: countText / countMessages match estimateTokens", () => {
    const text = "hello world twelve";
    assert.equal(counter.countText(text), Math.floor(text.length / 4));
    const messages = [msg("user", "abcd"), msg("assistant", "efgh")];
    assert.equal(counter.countMessages(messages), estimateTokens(messages));
  });

  it("H2: empty messages → 0", () => {
    assert.equal(counter.countMessages([]), 0);
    assert.equal(counter.countText(""), 0);
  });
});
