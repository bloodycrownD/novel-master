import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emitDirectTextDelta } from "../../../src/infra/llm-protocol/logic/inline-thinking-parser.js";

describe("inline-thinking-parser", () => {
  it("emitDirectTextDelta 直通写入 textParts 并发出 text-delta", () => {
    const state = { textParts: [] as string[] };
    const events: Array<{ type: string; text: string }> = [];
    emitDirectTextDelta(state, "Hello", (ev) => {
      if (ev.type === "text-delta") {
        events.push(ev);
      }
    });
    assert.deepEqual(state.textParts, ["Hello"]);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.text, "Hello");
  });

  it("emitDirectTextDelta 忽略空字符串", () => {
    const state = { textParts: [] as string[] };
    let called = false;
    emitDirectTextDelta(state, "", () => {
      called = true;
    });
    assert.deepEqual(state.textParts, []);
    assert.equal(called, false);
  });
});
