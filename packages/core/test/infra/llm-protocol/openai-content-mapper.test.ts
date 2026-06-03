import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderError } from "../../../src/errors/provider-errors.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";
import {
  blocksToOpenAiMessageContent,
  chatMessagesToOpenAi,
  openAiChoiceToBlocks,
} from "../../../src/infra/llm-protocol/logic/openai-content-mapper.js";

describe("openai-content-mapper", () => {
  it("O1: text + tool_use â†?assistant message with tool_calls", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        sessionId: "s1",
        seq: 1,
        role: "assistant",
        content: {
          blocks: [
            { type: "text", text: "I'll read the file." },
            {
              type: "tool_use",
              id: "call_abc",
              name: "vfs.read",
              input: { path: "/tmp/a.txt" },
            },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      },
    ];

    const out = chatMessagesToOpenAi(messages);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.role, "assistant");
    assert.equal(out[0]!.content, "I'll read the file.");
    const toolCalls = out[0]!.tool_calls as Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0]!.id, "call_abc");
    assert.equal(toolCalls[0]!.type, "function");
    assert.equal(toolCalls[0]!.function.name, "vfs.read");
    assert.deepEqual(JSON.parse(toolCalls[0]!.function.arguments), {
      path: "/tmp/a.txt",
    });
  });

  it("O2: OpenAI tool_calls response â†?tool_use blocks", () => {
    const blocks = openAiChoiceToBlocks({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_xyz",
          type: "function",
          function: {
            name: "vfs.write",
            arguments: '{"path":"/out.txt","content":"hi"}',
          },
        },
      ],
    });

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "tool_use");
    if (blocks[0]!.type !== "tool_use") {
      return;
    }
    assert.equal(blocks[0].id, "call_xyz");
    assert.equal(blocks[0].name, "vfs.write");
    assert.deepEqual(blocks[0].input, { path: "/out.txt", content: "hi" });
  });

  it("O3: tool_result â†?role tool messages with tool_call_id", () => {
    const messages: ChatMessage[] = [
      {
        id: "u1",
        sessionId: "s1",
        seq: 1,
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "call_abc",
              content: "file contents here",
            },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      },
    ];

    const out = chatMessagesToOpenAi(messages);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.role, "tool");
    assert.equal(out[0]!.tool_call_id, "call_abc");
    assert.equal(out[0]!.content, "file contents here");
  });

  it("O6: image url block â†?vision image_url part", () => {
    const content = blocksToOpenAiMessageContent([
      { type: "text", text: "describe this" },
      {
        type: "image",
        source: { kind: "url", url: "https://example.com/a.png" },
      },
    ]);
    assert.ok(Array.isArray(content));
    const parts = content as Array<{ type: string; image_url?: { url: string } }>;
    assert.equal(parts.length, 2);
    assert.equal(parts[1]!.type, "image_url");
    assert.equal(parts[1]!.image_url!.url, "https://example.com/a.png");
  });

  it("rejects thinking blocks outbound", () => {
    assert.throws(
      () =>
        blocksToOpenAiMessageContent([{ type: "thinking", text: "hmm" }]),
      (e: unknown) => e instanceof ProviderError && e.code === "UNSUPPORTED_CONTENT",
    );
  });

  it("maps reasoning_content inbound to thinking when content is present", () => {
    const blocks = openAiChoiceToBlocks({
      content: "answer",
      reasoning_content: "internal chain",
    });
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "thinking");
    assert.equal(blocks[1]!.type, "text");
  });

  it("maps reasoning-only inbound to thinking only (no GLM promotion)", () => {
    const blocks = openAiChoiceToBlocks({
      content: "",
      reasoning_content: "visible reply",
    });
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "thinking");
    if (blocks[0]!.type === "thinking") {
      assert.equal(blocks[0].text, "visible reply");
    }
  });
});
