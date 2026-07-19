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

  it("dynamic 块无 lifecycle 时省略字段", () => {
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

  it("dynamic 块 lifecycle once 写入 wire", () => {
    const block: DynamicPromptBlock = {
      name: "once",
      type: "text",
      role: "assistant",
      content: "x",
      lifecycle: "once",
    };
    assert.deepEqual(dynamicBlockToWire(block), {
      type: "text",
      role: "assistant",
      content: "x",
      lifecycle: "once",
    });
  });
});
