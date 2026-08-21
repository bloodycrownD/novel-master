import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatMessagesToAnthropic } from "../../../src/infra/llm-protocol/logic/anthropic-content-mapper.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";

describe("anthropic-content-mapper", () => {
  it("T-PM1: tool_result user + 文本 user 合并为单条 user，tool_result 块前置", () => {
    const messages: ChatMessage[] = [
      {
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
      {
        role: "user",
        content: {
          blocks: [{ type: "text", text: "继续读下一个文件" }],
        },
      },
    ];

    const out = chatMessagesToAnthropic(messages);
    assert.equal(out.length, 2);
    assert.equal(out[0]!.role, "assistant");
    assert.equal(out[1]!.role, "user");
    assert.equal(out[1]!.content.length, 2);
    assert.equal(out[1]!.content[0]!.type, "tool_result");
    assert.equal(
      (out[1]!.content[0] as { tool_use_id: string }).tool_use_id,
      "call_1",
    );
    assert.equal(out[1]!.content[1]!.type, "text");
    assert.equal(
      (out[1]!.content[1] as { text: string }).text,
      "继续读下一个文件",
    );
  });

  it("T-PM1: 三连 user 压为一条，块序保持拼接顺序", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: { blocks: [{ type: "text", text: "第一段" }] },
      },
      {
        role: "user",
        content: { blocks: [{ type: "text", text: "第二段" }] },
      },
      {
        role: "user",
        content: { blocks: [{ type: "text", text: "第三段" }] },
      },
    ];

    const out = chatMessagesToAnthropic(messages);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.role, "user");
    assert.deepEqual(
      out[0]!.content.map((item) => (item as { text: string }).text),
      ["第一段", "第二段", "第三段"],
    );
  });

  it("相邻 user 中间隔 assistant 时不合并", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: { blocks: [{ type: "text", text: "问一" }] },
      },
      {
        role: "assistant",
        content: { blocks: [{ type: "text", text: "答一" }] },
      },
      {
        role: "user",
        content: { blocks: [{ type: "text", text: "问二" }] },
      },
    ];

    const out = chatMessagesToAnthropic(messages);
    assert.equal(out.length, 3);
    assert.deepEqual(
      out.map((msg) => msg.role),
      ["user", "assistant", "user"],
    );
  });
});
