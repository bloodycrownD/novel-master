import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";
import { normalizeOrphanToolResultsForLlm } from "../../../src/service/prompt/normalize-orphan-tool-results-for-llm.js";

describe("normalizeOrphanToolResultsForLlm", () => {
  it("converts tool_result to text when assistant tool_use is not visible", () => {
    const messages: ChatMessage[] = [
      {
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
      },
    ];

    const out = normalizeOrphanToolResultsForLlm(messages);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.content.blocks.length, 1);
    assert.equal(out[0]?.content.blocks[0]?.type, "text");
    if (out[0]?.content.blocks[0]?.type === "text") {
      assert.match(out[0].content.blocks[0].text, /\[tool_result id=call_1\]/);
      assert.match(out[0].content.blocks[0].text, /file body/);
    }
  });

  it("keeps tool_result when matching tool_use is visible in history", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: {
          blocks: [
            {
              type: "tool_use",
              id: "call_1",
              name: "vfs.read",
              input: { path: "/a" },
            },
          ],
        },
      },
      {
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
      },
    ];

    const out = normalizeOrphanToolResultsForLlm(messages);
    assert.equal(out[1]?.content.blocks[0]?.type, "tool_result");
  });
});
