import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks, type ChatMessage } from "@novel-master/core/chat";

import { buildPromptLlmInputFromLayout } from "@novel-master/core/prompt";
import { normalizeOrphanToolResultsForLlm } from "../../../src/service/prompt/normalize-orphan-tool-results-for-llm.js";

describe("buildPromptLlmInputFromLayout tool pairing", () => {
  it("T6: synthetic template messages do not break tool_result pairing", async () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        sessionId: "s1",
        seq: 1,
        role: "assistant",
        content: {
          blocks: [
            {
              type: "tool_use",
              id: "call_1",
              name: "read",
              input: { path: "/a" },
            },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 1,
        hidden: false,
      },
      {
        id: "m2",
        sessionId: "s1",
        seq: 2,
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "call_1",
              content: "file body",
            },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 2,
        hidden: false,
      },
    ];

    const input = await buildPromptLlmInputFromLayout(
      {
        persistEnabled: true,
        persist: [{ name: "ctx", type: "text", role: "user", content: "context" }],
        dynamic: [],
      },
      {
        worktreeDisplay: "",
        messages,
      },
    );
    const normalized = normalizeOrphanToolResultsForLlm(input.messages);
    assert.equal(normalized.length, 3);
    assert.equal(normalized[0]!.id, "prompt:ctx");
    assert.equal(normalized[2]!.content.blocks[0]?.type, "tool_result");
  });
});
