import assert from "node:assert/strict";
import {  describe, it  } from "node:test";

import type { ChatMessageData } from "@/domain/chat/model/message.js";
import {  AnthropicMapper  } from "@/infra/llm-protocol/logic/anthropic-content-mapper.js";
import {  OpenAiMapper  } from "@/infra/llm-protocol/logic/openai-content-mapper.js";
import {  GeminiMapper  } from "@/infra/llm-protocol/logic/gemini-content-mapper.js";

// 六期签名适配：两个 mapper 返回 Result，本地同名 wrapper 拆包（失败原样抛出
// AppError），调用点与断言语义零改动。
const chatMessagesToOpenAi = (messages: Parameters<typeof chatMessagesToOpenAiImpl>[0]) => {
  const result = OpenAiMapper.chatMessagesTo(messages);
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

/**
 * T-M1 / P1-8：LLM adapter 的 content mapper 天然忽略 tool_result 的 meta/summary/ok。
 *
 * 入参含带 meta.subagentSessionId + summary + ok 的 tool_result 块，
 * 断言出参 wire 中**不含** `meta`/`summary`/`ok` 字段——验证无需额外剥离代码改动。
 */
describe("LLM content mapper 天然忽略 meta/summary/ok（T-M1 / P1-8）", () => {
  const messages: ChatMessageData[] = [
    {
      id: "u1",
      sessionId: "s1",
      seq: 1,
      role: "user",
      hidden: false,
      content: { blocks: [{ type: "tool_result", toolUseId: "tu1", content: "hello", ok: true, summary: "ok", meta: { subagentSessionId: "child-1" } }] },
    } as ChatMessageData,
  ];

  it("Anthropic: tool_result wire 只含 tool_use_id + content", () => {
    const out = AnthropicMapper.chatMessagesTo(messages);
    const json = JSON.stringify(out);
    assert.ok(json.includes("tu1"));
    assert.ok(json.includes("hello"));
    // 不应泄给 LLM：
    assert.ok(!json.includes("subagentSessionId"));
    assert.ok(!json.includes('"summary"'));
    assert.ok(!json.includes('"ok"'));
    assert.ok(!json.includes('"meta"'));
  });

  it("OpenAI: tool 消息 wire 只含 tool_call_id + content", () => {
    const out = chatMessagesToOpenAi(messages);
    const json = JSON.stringify(out);
    assert.ok(json.includes("tu1"));
    assert.ok(json.includes("hello"));
    assert.ok(!json.includes("subagentSessionId"));
    assert.ok(!json.includes('"summary"'));
    assert.ok(!json.includes('"ok"'));
    assert.ok(!json.includes('"meta"'));
  });

  it("Gemini: functionResponse.response.output 只含 content 文本", () => {
    const out = chatMessagesToGeminiContents(messages);
    const json = JSON.stringify(out);
    assert.ok(json.includes("tu1"));
    assert.ok(json.includes("hello"));
    assert.ok(!json.includes("subagentSessionId"));
    assert.ok(!json.includes('"summary"'));
    assert.ok(!json.includes('"ok"'));
    assert.ok(!json.includes('"meta"'));
  });
});
