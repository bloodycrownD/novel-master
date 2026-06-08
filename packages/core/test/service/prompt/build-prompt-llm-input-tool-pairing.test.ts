import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPromptLlmInput,
  textBlocks,
  type ChatMessage,
  type PromptBlock,
} from "@novel-master/core";
import { normalizeOrphanToolResultsForLlm } from "../../../src/service/prompt/normalize-orphan-tool-results-for-llm.js";

describe("buildPromptLlmInput tool pairing", () => {
  it("T6: synthetic template messages do not break tool_result pairing", () => {
    const blocks: PromptBlock[] = [
      { name: "ctx", type: "text", role: "user", content: "context" },
      { name: "c", type: "chat" },
    ];
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

    const input = buildPromptLlmInput(blocks, {
      worktreeDisplay: "",
      filetreeDisplay: "",
      messages,
    });
    const normalized = normalizeOrphanToolResultsForLlm(input.messages);
    assert.equal(normalized.length, 3);
    assert.equal(normalized[0]!.id, "prompt:ctx");
    assert.equal(normalized[2]!.content.blocks[0]?.type, "tool_result");
  });
});
