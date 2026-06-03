import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatMessagesToGeminiContents,
  geminiPartsToBlocks,
  toolsToGeminiFunctionDeclarations,
} from "../../../src/infra/llm-protocol/logic/gemini-content-mapper.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";

describe("gemini-content-mapper", () => {
  it("T5: multi-turn history with tool_result", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: { blocks: [{ type: "text", text: "read file" }] },
      },
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

    const contents = chatMessagesToGeminiContents(messages);
    assert.ok(contents.length >= 3);
    const toolResultTurn = contents.find((c) =>
      c.parts.some((p) => p.functionResponse != null),
    );
    assert.ok(toolResultTurn);
  });

  it("round-trips functionCall to tool_use", () => {
    const blocks = geminiPartsToBlocks([
      {
        functionCall: { name: "vfs.read", args: { path: "/b" } },
      },
    ]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "tool_use");
    if (blocks[0]?.type === "tool_use") {
      assert.equal(blocks[0].name, "vfs.read");
    }
  });

  it("toolsToGeminiFunctionDeclarations wraps schemas", () => {
    const tools = toolsToGeminiFunctionDeclarations([
      { name: "vfs.read", description: "read", inputSchema: { type: "object" } },
    ]);
    assert.equal(tools.length, 1);
    const decls = (tools[0] as { functionDeclarations: unknown[] }).functionDeclarations;
    assert.equal(decls.length, 1);
  });
});
