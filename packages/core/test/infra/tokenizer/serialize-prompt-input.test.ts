import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  serializePromptLlmInput  } from "../../../src/infra/tokenizer/logic/serialize-prompt-input.js";
import type { ChatMessageData } from "../../../src/domain/chat/model/message.js";

describe("serializePromptLlmInput", () => {
  it("S1: system + two messages via assembly format", async () => {
    const messages: ChatMessageData[] = [
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
    const out = await serializePromptLlmInput(
      {
        system: "You are helpful.",
        persist: [],
        dynamic: [],
      },
      {
        workplaceDisplay: "",
        messages,
      },
    );
    assert.ok(out.ok, JSON.stringify(out));
    assert.match(out.value, /system: You are helpful\./);
    assert.match(out.value, /user: hi/);
    assert.match(out.value, /assistant: hello/);
  });
});
