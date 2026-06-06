import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializePromptLlmInput } from "../../../src/infra/tokenizer/logic/serialize-prompt-input.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";
import type { PromptBlock } from "../../../src/domain/prompt/model/prompt-block.js";

describe("serializePromptLlmInput", () => {
  it("S1: system + two messages via assembly format", () => {
    const blocks: PromptBlock[] = [
      { name: "s", type: "text", role: "system", content: "You are helpful." },
      { name: "c", type: "chat" },
    ];
    const messages: ChatMessage[] = [
      {
        id: "1",
        sessionId: "s",
        seq: 1,
        role: "user",
        content: { blocks: [{ type: "text", text: "hi" }] },
        hidden: false,
        createdAtMs: 0,
      },
      {
        id: "2",
        sessionId: "s",
        seq: 2,
        role: "assistant",
        content: { blocks: [{ type: "text", text: "hello" }] },
        hidden: false,
        createdAtMs: 0,
      },
    ];
    const out = serializePromptLlmInput(blocks, {
      worktreeDisplay: "",
      filetreeDisplay: "",
      messages,
    });
    assert.match(out, /system: You are helpful\./);
    assert.match(out, /user: hi/);
    assert.match(out, /assistant: hello/);
  });
});
