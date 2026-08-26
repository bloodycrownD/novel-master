/**
 * applyThinkingContextForLlm 单测（spec §测试策略 T-TC1 ~ T-TC8、T-PV2 纯函数部分）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";
import type { ContentBlock } from "../../../src/domain/chat/model/content-block.js";
import { applyThinkingContextForLlm } from "../../../src/service/prompt/apply-thinking-context-for-llm.js";

function msg(
  role: string,
  options?: {
    readonly id?: string;
    readonly raw?: Record<string, unknown> | null;
    readonly blocks?: readonly ContentBlock[];
  },
): ChatMessage {
  const blocks = options?.blocks ?? [{ type: "text" as const, text: "t" }];
  return {
    id: options?.id ?? `m-${role}-${Math.random().toString(36).slice(2)}`,
    sessionId: "s1",
    seq: 1,
    role,
    content: { blocks },
    provider: null,
    raw: options?.raw ?? null,
    createdAtMs: 0,
    hidden: false,
  };
}

function user(text: string, id?: string): ChatMessage {
  return msg("user", { id, blocks: [{ type: "text", text }] });
}

function toolResultUser(toolUseId: string, id?: string): ChatMessage {
  return msg("user", {
    id,
    blocks: [{ type: "tool_result", toolUseId, content: "ok" }],
  });
}

function assistantThinking(options?: {
  readonly id?: string;
  readonly withToolUse?: boolean;
  readonly withRedacted?: boolean;
  readonly withSignature?: boolean;
  readonly text?: string;
}): ChatMessage {
  const blocks: ContentBlock[] = [
    {
      type: "thinking",
      text: options?.text ?? "思考中…",
      ...(options?.withSignature
        ? { thinkingSignature: "sig-abc123" }
        : {}),
    },
  ];
  if (options?.withRedacted) {
    blocks.push({ type: "redacted_thinking", data: "opaque-data" });
  }
  blocks.push({ type: "text", text: "回答" });
  if (options?.withToolUse) {
    blocks.push({
      type: "tool_use",
      id: `tu_${options.id ?? "x"}`,
      name: "read",
      input: {},
    });
  }
  return msg("assistant", { id: options?.id, blocks });
}

function thinkingBlocks(message: ChatMessage): ContentBlock[] {
  return message.content.blocks.filter(
    (block) =>
      block.type === "thinking" || block.type === "redacted_thinking",
  );
}

describe("applyThinkingContextForLlm", () => {
  it("T-TC1 开·历史剥离：边界前 assistant thinking 剥离，其余块原样", () => {
    const a1 = assistantThinking({ id: "a1", withSignature: true });
    const messages = [user("u1", "u-1"), a1, user("u2", "u-2"), msg("assistant", { id: "a2" })];
    const out = applyThinkingContextForLlm(messages, {
      enabled: true,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    assert.equal(thinkingBlocks(out[1]!).length, 0);
    assert.equal(out[1]!.content.blocks.length, 1);
    assert.equal(out[1]!.content.blocks[0]!.type, "text");
    // 其余消息原样（引用不变）
    assert.equal(out[0], messages[0]);
    assert.equal(out[2], messages[2]);
    assert.equal(out[3], messages[3]);
  });

  it("T-TC2 开·最新轮与工具循环保留：边界后 thinking/redacted 原样回传（签名、顺序、逐字节不变）", () => {
    const u = user("u1", "u-1");
    const a1 = assistantThinking({ id: "a1", withToolUse: true, withSignature: true });
    const r1 = toolResultUser("tu_a1", "r-1");
    const a2 = assistantThinking({
      id: "a2",
      withToolUse: true,
      withRedacted: true,
      withSignature: true,
    });
    const r2 = toolResultUser("tu_a2", "r-2");
    const out = applyThinkingContextForLlm([u, a1, r1, a2, r2], {
      enabled: true,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    assert.equal(out[1], a1);
    assert.equal(out[3], a2);
    assert.deepEqual(out[1]!.content.blocks, a1.content.blocks);
    assert.deepEqual(out[3]!.content.blocks, a2.content.blocks);
  });

  it("T-TC3 关·anthropic 最低保留：仅最后一条含 tool_use 的 assistant 保留，其余全剥", () => {
    const u = user("u1", "u-1");
    const a1 = assistantThinking({ id: "a1", withToolUse: true, withSignature: true });
    const r1 = toolResultUser("tu_a1", "r-1");
    const a2 = assistantThinking({
      id: "a2",
      withToolUse: true,
      withRedacted: true,
      withSignature: true,
    });
    const r2 = toolResultUser("tu_a2", "r-2");
    const out = applyThinkingContextForLlm([u, a1, r1, a2, r2], {
      enabled: false,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    assert.equal(thinkingBlocks(out[1]!).length, 0);
    assert.equal(out[3], a2);
    assert.deepEqual(thinkingBlocks(out[3]!), [
      { type: "thinking", text: "思考中…", thinkingSignature: "sig-abc123" },
      { type: "redacted_thinking", data: "opaque-data" },
    ]);
  });

  it("T-TC3 关·已完结工具循环不触发最低保留：最后一条 assistant 无 tool_use 时全剥", () => {
    const u1 = user("u1", "u-1");
    const a1 = assistantThinking({ id: "a1", withToolUse: true, withSignature: true });
    const r1 = toolResultUser("tu_a1", "r-1");
    const a2 = msg("assistant", { id: "a2" });
    const u2 = user("u2", "u-2");
    const out = applyThinkingContextForLlm([u1, a1, r1, a2, u2], {
      enabled: false,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    assert.equal(thinkingBlocks(out[1]!).length, 0);
  });

  it("T-TC3 关·档位 off（requestThinkingEnabled false）时全部剥离、无任何最低保留", () => {
    const u = user("u1", "u-1");
    const a1 = assistantThinking({ id: "a1", withToolUse: true, withSignature: true });
    const r1 = toolResultUser("tu_a1", "r-1");
    const a2 = assistantThinking({
      id: "a2",
      withToolUse: true,
      withRedacted: true,
      withSignature: true,
    });
    const r2 = toolResultUser("tu_a2", "r-2");
    const out = applyThinkingContextForLlm([u, a1, r1, a2, r2], {
      enabled: false,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: false,
    });
    for (const message of out) {
      assert.equal(thinkingBlocks(message).length, 0);
    }
  });

  it("T-TC4 关·gemini 同规则保留", () => {
    const u = user("u1", "u-1");
    const a1 = assistantThinking({ id: "a1", withToolUse: true, withSignature: true });
    const r1 = toolResultUser("tu_a1", "r-1");
    const out = applyThinkingContextForLlm([u, a1, r1], {
      enabled: false,
      protocol: "gemini",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    assert.equal(out[1], a1);
  });

  it("T-TC4 关·openai 全剥（无最低保留）", () => {
    const u = user("u1", "u-1");
    const a1 = assistantThinking({ id: "a1", withToolUse: true, withSignature: true });
    const r1 = toolResultUser("tu_a1", "r-1");
    const out = applyThinkingContextForLlm([u, a1, r1], {
      enabled: false,
      protocol: "openai",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    assert.equal(thinkingBlocks(out[1]!).length, 0);
  });

  it("T-TC4 开·openai 行为与 anthropic 相同口径（剥离不改变 openai 过滤语义）", () => {
    const a1 = assistantThinking({ id: "a1", withSignature: true });
    const messages = [user("u1", "u-1"), a1, user("u2", "u-2"), msg("assistant", { id: "a2" })];
    const anthropicOut = applyThinkingContextForLlm(messages, {
      enabled: true,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    const openaiOut = applyThinkingContextForLlm(messages, {
      enabled: true,
      protocol: "openai",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    assert.deepEqual(openaiOut, anthropicOut);
  });

  it("T-TC5 tool_result 载体 user 消息不重置边界（边界仍在更早的真实输入）", () => {
    const u1 = user("u1", "u-1");
    const a1 = assistantThinking({ id: "a1", withToolUse: true, withSignature: true });
    const r1 = toolResultUser("tu_a1", "r-1");
    // r1 不算真实用户输入：边界是 u1，a1 属于最新轮、保留
    const out = applyThinkingContextForLlm([u1, a1, r1], {
      enabled: true,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    assert.equal(out[1], a1);
  });

  it("T-TC5 无任何真实 user 消息时全历史剥离", () => {
    const a1 = assistantThinking({ id: "a1", withSignature: true });
    const r1 = toolResultUser("tu_a1", "r-1");
    const out = applyThinkingContextForLlm([a1, r1], {
      enabled: true,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    assert.equal(thinkingBlocks(out[0]!).length, 0);
  });

  it("T-TC5 user_vfs_action 合成消息重置边界（其后的 assistant thinking 保留）", () => {
    const u1 = user("u1", "u-1");
    const a1 = assistantThinking({ id: "a1", withSignature: true });
    const vfsAction = msg("user", {
      id: "vfs-1",
      raw: { metadata: { kind: "user_vfs_action", source: "user" } },
    });
    const a2 = assistantThinking({ id: "a2", withSignature: true });
    const out = applyThinkingContextForLlm([u1, a1, vfsAction, a2], {
      enabled: true,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    assert.equal(thinkingBlocks(out[1]!).length, 0);
    assert.equal(out[3], a2);
  });

  it("T-TC5 tool_turn_bridge（assistant 合成）不参与边界判定", () => {
    const u1 = user("u1", "u-1");
    const bridge = msg("assistant", {
      id: "bridge-1",
      raw: { metadata: { kind: "tool_turn_bridge", synthetic: true } },
    });
    const a2 = assistantThinking({ id: "a2", withSignature: true });
    const out = applyThinkingContextForLlm([u1, bridge, a2], {
      enabled: true,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    // 边界是 u1；bridge 与 a2 都在最新轮，thinking 原样
    assert.equal(out[2], a2);
  });

  it("T-TC6 不可变性：无 thinking 的消息返回原对象引用；入参不被修改", () => {
    const u1 = user("u1", "u-1");
    const a1 = assistantThinking({ id: "a1", withSignature: true });
    const u2 = user("u2", "u-2");
    const plain = msg("assistant", { id: "a-plain" });
    const input = [u1, a1, u2, plain];
    const snapshot = JSON.stringify(input);
    const out = applyThinkingContextForLlm(input, {
      enabled: true,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    assert.equal(out[0], u1);
    assert.equal(out[2], u2);
    assert.equal(out[3], plain);
    assert.equal(JSON.stringify(input), snapshot);
    assert.notEqual(out[1], a1);
    assert.equal(a1.content.blocks.length, 2);
  });

  it("T-TC7 合成消息不重置边界：prompt: 前缀 user 合成消息之后的 assistant thinking 仍按边界剥离", () => {
    const u1 = user("u1", "u-1");
    const a1 = assistantThinking({ id: "a1", withSignature: true });
    const u2 = user("u2", "u-2");
    const a2 = assistantThinking({ id: "a2", withSignature: true });
    const syntheticUser = msg("user", {
      id: "prompt:dynamic",
      blocks: [{ type: "text", text: "<dynamic/>" }],
    });
    const syntheticWorkplace = msg("user", {
      id: "prompt:workplace",
      blocks: [{ type: "text", text: "<workplace/>" }],
    });
    const syntheticSkills = msg("user", {
      id: "prompt:skills",
      blocks: [{ type: "text", text: "<skills/>" }],
    });
    const out = applyThinkingContextForLlm([
      u1,
      a1,
      u2,
      a2,
      syntheticUser,
      syntheticWorkplace,
      syntheticSkills,
    ], {
      enabled: true,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    // 边界仍在 u2（合成消息不重置）：a1 在边界前被剥离，a2 在最新轮保留
    assert.equal(thinkingBlocks(out[1]!).length, 0);
    assert.equal(out[3], a2);
  });

  it("T-TC8 档位前置全局门：开态 + 档位 off 时全部剥离（最新轮也不保留）", () => {
    const u = user("u1", "u-1");
    const a1 = assistantThinking({ id: "a1", withToolUse: true, withSignature: true });
    const r1 = toolResultUser("tu_a1", "r-1");
    const a2 = assistantThinking({
      id: "a2",
      withToolUse: true,
      withRedacted: true,
      withSignature: true,
    });
    const r2 = toolResultUser("tu_a2", "r-2");
    for (const protocol of ["anthropic", "gemini"] as const) {
      const out = applyThinkingContextForLlm([u, a1, r1, a2, r2], {
        enabled: true,
        protocol,
        retainProtocolMinimum: true,
        requestThinkingEnabled: false,
      });
      for (const message of out) {
        assert.equal(thinkingBlocks(message).length, 0, protocol);
      }
    }
  });

  it("T-TC8 关态 + 档位 off 的输出与开态 + 档位 off 一致", () => {
    const u = user("u1", "u-1");
    const a1 = assistantThinking({ id: "a1", withToolUse: true, withSignature: true });
    const r1 = toolResultUser("tu_a1", "r-1");
    const input = [u, a1, r1];
    const onOff = applyThinkingContextForLlm(input, {
      enabled: true,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: false,
    });
    const offOff = applyThinkingContextForLlm(input, {
      enabled: false,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: false,
    });
    assert.deepEqual(offOff, onOff);
  });

  it("T-PV2 预览口径：retainProtocolMinimum false 时关态输出不含任何 thinking；开态与 wire 可见集合一致；含合成消息两侧剥离集合一致", () => {
    const u = user("u1", "u-1");
    const a1 = assistantThinking({ id: "a1", withToolUse: true, withSignature: true });
    const r1 = toolResultUser("tu_a1", "r-1");
    const a2 = assistantThinking({ id: "a2", withToolUse: true, withRedacted: true });

    // 关态预览：协议最低保留不进预览
    const previewOff = applyThinkingContextForLlm([u, a1, r1], {
      enabled: false,
      protocol: "anthropic",
      retainProtocolMinimum: false,
      requestThinkingEnabled: true,
    });
    for (const message of previewOff) {
      assert.equal(thinkingBlocks(message).length, 0);
    }

    // wire 形态（含 prompt: 合成消息）与预览形态（无合成消息）开态剥离集合一致
    const synthetic = msg("user", {
      id: "prompt:dynamic",
      blocks: [{ type: "text", text: "<dynamic/>" }],
    });
    const wireInput = [u, a1, r1, a2, synthetic];
    const previewInput = [u, a1, r1, a2];
    const wireOut = applyThinkingContextForLlm(wireInput, {
      enabled: true,
      protocol: "anthropic",
      retainProtocolMinimum: true,
      requestThinkingEnabled: true,
    });
    const previewOut = applyThinkingContextForLlm(previewInput, {
      enabled: true,
      protocol: "anthropic",
      retainProtocolMinimum: false,
      requestThinkingEnabled: true,
    });
    const wireSet = wireOut
      .slice(0, 4)
      .map((message) => thinkingBlocks(message).length)
      .join(",");
    const previewSet = previewOut
      .map((message) => thinkingBlocks(message).length)
      .join(",");
    assert.equal(previewSet, wireSet);
  });
});
