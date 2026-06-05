import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatMessagesToGeminiContents,
  geminiPartsToBlocks,
  toolsToGeminiFunctionDeclarations,
} from "../../../src/infra/llm-protocol/logic/gemini-content-mapper.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";
import { normalizeOrphanToolResultsForLlm } from "../../../src/service/prompt/normalize-orphan-tool-results-for-llm.js";

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
    const fr = toolResultTurn!.parts.find((p) => p.functionResponse != null)
      ?.functionResponse as { name: string };
    assert.equal(fr.name, "vfs.read");
  });

  it("outbound tool_result uses function name on functionResponse.name", () => {
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

    const contents = chatMessagesToGeminiContents(messages);
    const toolResultTurn = contents.find((c) =>
      c.parts.some((p) => p.functionResponse != null),
    );
    assert.ok(toolResultTurn);
    const fr = toolResultTurn!.parts.find((p) => p.functionResponse != null)
      ?.functionResponse as { name: string };
    assert.equal(fr.name, "vfs.read");
  });

  it("inbound functionResponse.name resolves to NM toolUseId", () => {
    const blocks = geminiPartsToBlocks(
      [
        {
          functionResponse: {
            name: "vfs.read",
            response: { output: "file body" },
          },
        },
      ],
      { toolUseIdByFunctionName: new Map([["vfs.read", "call_1"]]) },
    );
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "tool_result");
    if (blocks[0]?.type === "tool_result") {
      assert.equal(blocks[0].toolUseId, "call_1");
    }
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

  it("resolves function name from hidden tool_use via lookup messages", () => {
    const lookupMessages: ChatMessage[] = [
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
    ];
    const visible: ChatMessage[] = [
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

    const contents = chatMessagesToGeminiContents(visible, {
      toolLookupMessages: lookupMessages,
    });
    const toolResultTurn = contents.find((c) =>
      c.parts.some((p) => p.functionResponse != null),
    );
    assert.ok(toolResultTurn);
    const fr = toolResultTurn!.parts.find((p) => p.functionResponse != null)
      ?.functionResponse as { name: string; id: string };
    assert.equal(fr.name, "vfs.read");
    assert.equal(fr.id, "call_1");
  });

  it("injects synthetic model functionCall when tool_use turn is hidden", () => {
    const lookupMessages: ChatMessage[] = [
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
    ];
    const visible: ChatMessage[] = [
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

    const contents = chatMessagesToGeminiContents(visible, {
      toolLookupMessages: lookupMessages,
    });
    assert.equal(contents.length, 2);
    assert.equal(contents[0]?.role, "model");
    assert.ok(contents[0]?.parts.some((p) => p.functionCall != null));
    assert.equal(contents[1]?.role, "user");
    assert.ok(contents[1]?.parts.some((p) => p.functionResponse != null));
  });

  it("assembly normalize + gemini mapper never emits functionResponse for orphan tool_result", () => {
    const visible: ChatMessage[] = [
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
    const normalized = normalizeOrphanToolResultsForLlm(visible);
    const contents = chatMessagesToGeminiContents(normalized);
    assert.equal(contents[0]?.role, "user");
    assert.equal(contents[0]?.parts[0]?.functionResponse, undefined);
    assert.match(contents[0]?.parts[0]?.text as string, /file body/);
  });

  it("orphaned tool_result falls back to plain user text (compaction-safe)", () => {
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

    const contents = chatMessagesToGeminiContents(messages);
    assert.equal(contents.length, 1);
    assert.equal(contents[0]?.role, "user");
    const text = contents[0]?.parts[0]?.text as string;
    assert.match(text, /\[tool_result id=call_1\]/);
    assert.match(text, /file body/);
    assert.equal(contents[0]?.parts[0]?.functionResponse, undefined);
  });

  it("orphaned tool_result without toolUseId still serializes as user text", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: {
          blocks: [{ type: "tool_result", content: "ok" } as never],
        },
      },
    ];

    const contents = chatMessagesToGeminiContents(messages);
    const text = contents[0]?.parts[0]?.text as string;
    assert.match(text, /\[tool_result/);
    assert.equal(contents[0]?.parts[0]?.functionResponse, undefined);
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
