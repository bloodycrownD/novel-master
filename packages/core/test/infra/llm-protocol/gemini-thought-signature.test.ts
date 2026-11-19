import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  GeminiMapper  } from "../../../src/infra/llm-protocol/logic/gemini-content-mapper.js";
import type { ChatMessageData } from "../../../src/domain/chat/model/message.js";

// 六期签名适配：两个 mapper 返回 Result，本地同名 wrapper 拆包（失败原样抛出
// AppError），调用点与断言语义零改动。
const blocksToGeminiParts = (blocks: Parameters<typeof blocksToGeminiPartsImpl>[0]) => {
  const result = GeminiMapper.blocksToParts(blocks);
  if (!result.ok) throw result.error;
  return result.value;
};
const chatMessagesToGeminiContents = (
  messages: Parameters<typeof chatMessagesToGeminiContentsImpl>[0],
  options?: Parameters<typeof chatMessagesToGeminiContentsImpl>[1],
) => {
  const result = GeminiMapper.chatMessagesToContents(messages, options);
  if (!result.ok) throw result.error;
  return result.value;
};

describe("gemini thought_signature", () => {
  it("parses thought_signature on thinking parts", () => {
    const blocks = GeminiMapper.partsToBlocks([
      {
        text: "reasoning",
        thought: true,
        thought_signature: "sig-thinking-abc",
      },
    ]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "thinking");
    if (blocks[0]?.type === "thinking") {
      assert.equal(blocks[0].text, "reasoning");
      assert.equal(blocks[0].thinkingSignature, "sig-thinking-abc");
    }
  });

  it("parses thought_signature on functionCall parts", () => {
    const blocks = GeminiMapper.partsToBlocks([
      {
        functionCall: { name: "read", args: { path: "/a" }, id: "call_1" },
        thought_signature: "sig-fc-xyz",
      },
    ]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "tool_use");
    if (blocks[0]?.type === "tool_use") {
      assert.equal(blocks[0].thinkingSignature, "sig-fc-xyz");
    }
  });

  it("round-trips thinking thought_signature", () => {
    const parts = blocksToGeminiParts([
      { type: "thinking", text: "plan", thinkingSignature: "sig-round" },
    ]);
    assert.equal(parts.length, 1);
    assert.equal(parts[0]?.thought, true);
    assert.equal(parts[0]?.thought_signature, "sig-round");
    const back = GeminiMapper.partsToBlocks(parts);
    assert.equal(back[0]?.type, "thinking");
    if (back[0]?.type === "thinking") {
      assert.equal(back[0].thinkingSignature, "sig-round");
    }
  });

  it("parallel function calls: only first tool_use emits thought_signature", () => {
    const parts = blocksToGeminiParts([
      {
        type: "tool_use",
        id: "c1",
        name: "read",
        input: {},
        thinkingSignature: "sig-first",
      },
      {
        type: "tool_use",
        id: "c2",
        name: "write",
        input: {},
        thinkingSignature: "sig-second",
      },
    ]);
    assert.equal(parts.length, 2);
    assert.equal(parts[0]?.thought_signature, "sig-first");
    assert.equal(parts[1]?.thought_signature, undefined);
  });

  it("chatMessagesToGeminiContents preserves thought_signature on model turn", () => {
    const messages: ChatMessageData[] = [
      {
        role: "assistant",
        content: {
          blocks: [
            {
              type: "thinking",
              text: "plan",
              thinkingSignature: "sig-history",
            },
            {
              type: "tool_use",
              id: "call_1",
              name: "read",
              input: { path: "/a" },
            },
          ],
        },
      },
    ];
    const contents = chatMessagesToGeminiContents(messages);
    const modelTurn = contents.find((c) => c.role === "model");
    assert.ok(modelTurn);
    const thinkingPart = modelTurn!.parts.find((p) => p.thought === true);
    assert.equal(thinkingPart?.thought_signature, "sig-history");
  });
});
