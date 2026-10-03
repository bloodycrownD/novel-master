import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dynamicBlockToWire,
  persistBlockToWire,
} from "../../src/domain/prompt/logic/agent-prompt-layout-wire.js";
import type {
  DynamicPromptBlock,
  PersistTextPromptBlock,
} from "../../src/domain/prompt/model/agent-prompt-layout.js";

describe("agent-prompt-layout-wire", () => {
  it("persist text 块 wire 形状", () => {
    const block: PersistTextPromptBlock = {
      name: "intro",
      type: "text",
      role: "user",
      content: "hello",
    };
    assert.deepEqual(persistBlockToWire(block), {
      type: "text",
      role: "user",
      content: "hello",
    });
  });

  it("dynamic 块恒不含 lifecycle 键", () => {
    const block: DynamicPromptBlock = {
      name: "state",
      type: "text",
      role: "user",
      content: "{{$filetree}}",
    };
    assert.deepEqual(dynamicBlockToWire(block), {
      type: "text",
      role: "user",
      content: "{{$filetree}}",
    });
  });
});
