import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encoding_for_model } from "tiktoken";
import { HeuristicTokenCounter, type ChatMessage } from "@novel-master/core";
import { TiktokenTokenCounter } from "../src/impl/tiktoken-token-counter.js";

function msg(text: string): ChatMessage {
  return {
    id: "1",
    sessionId: "s",
    seq: 1,
    role: "user",
    content: { blocks: [{ type: "text", text }] },
    hidden: false,
    createdAtMs: 0,
  };
}

describe("TiktokenTokenCounter", () => {
  it("T1: fixed English and Chinese strings", () => {
    const counter = new TiktokenTokenCounter("gpt-4o");
    const enc = encoding_for_model("gpt-4o");
    assert.equal(counter.countText("hello"), enc.encode("hello").length);
    assert.equal(counter.countText("你好"), enc.encode("你好").length);
  });

  it("T2: message overhead exceeds plain text count", () => {
    const counter = new TiktokenTokenCounter("gpt-4o");
    const text = "hello";
    const plain = counter.countText(text);
    const withOverhead = counter.countMessages([msg(text)]);
    assert.ok(withOverhead > plain);
  });

  it("differs from heuristic for gpt-4o sample", () => {
    const tik = new TiktokenTokenCounter("gpt-4o");
    const heu = new HeuristicTokenCounter();
    const sample = "The quick brown fox jumps over the lazy dog.";
    assert.notEqual(tik.countText(sample), heu.countText(sample));
  });
});
