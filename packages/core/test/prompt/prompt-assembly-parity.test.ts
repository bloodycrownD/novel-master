import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks, type ChatMessage } from "@novel-master/core/chat";

import { formatPromptLlmInputForCliFromLayout, type AgentPromptLayout } from "@novel-master/core/prompt";

import { serializePromptLlmInput } from "@novel-master/core/provider";

const layout: AgentPromptLayout = {
  system: "ctx",
  persistEnabled: true,
  persist: [{ name: "u", type: "text", role: "user", content: "ask" }],
  dynamic: [],
};

function message(role: string, content: string, seq: number): ChatMessage {
  return {
    id: `m${seq}`,
    sessionId: "s1",
    seq,
    role,
    content: textBlocks(content),
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

describe("prompt assembly parity", () => {
  it("T2: serializePromptLlmInput equals formatPromptLlmInputForCliFromLayout", async () => {
    const ctx = {
      workplaceDisplay: "WT",
      messages: [message("user", "hi", 1)],
    };
    const serialized = await serializePromptLlmInput(layout, ctx);
    const formatted = await formatPromptLlmInputForCliFromLayout(layout, ctx);
    assert.equal(serialized, formatted);
  });

  it("hidden messages excluded from chat segment", async () => {
    const fullCtx = {
      workplaceDisplay: "",
      messages: [
        message("user", "visible", 1),
        { ...message("assistant", "hidden", 2), hidden: true },
      ],
    };
    const hiddenCtx = {
      workplaceDisplay: "",
      messages: [message("user", "visible", 1)],
    };
    const full = await serializePromptLlmInput(layout, fullCtx);
    const hidden = await serializePromptLlmInput(layout, hiddenCtx);
    assert.equal(full, hidden);
  });
});
