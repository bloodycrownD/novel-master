/**
 * chip 估算读数的进程内记忆（2026-09-30「切会话重算」治本回归锁）。
 *
 * 核心断言面：
 * - 记忆在 resolve 估算分支**序列化之前**被 consulted——注入精确档条目后，
 *   同键估算调用必须原样吐出注入值（删掉记忆查找即红：会回落真估算值）；
 * - 无 workplaceFingerprint 不缓存（键为 null，注入不生效）；
 * - 消息变了键就变（miss → 重算，防陈旧）；
 * - 精确分支完成时回写记忆——下一次估算帧拿到精确档（升级语义，与
 *   「preferEstimate 先查 L1」同精神）。
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { registerNodeTokenizerDriverForTests } from "../../helpers/register-node-tokenizer-driver-for-tests.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";
import {
  createDefaultTokenCounterRegistry,
  resolveCurrentPromptTokens,
  sessionApiPromptTokenCache,
} from "../../../src/infra/tokenizer/index.js";
import {
  buildChatTokenEstimateMemoKey,
  clearChatTokenEstimateMemo,
  lookupChatTokenEstimateMemo,
  rememberChatTokenEstimateMemo,
  stampMessagesForEstimateMemo,
} from "../../../src/infra/tokenizer/logic/chat-token-estimate-memo.js";
import type { PromptRenderContext } from "../../../src/domain/prompt/model/prompt-render-context.js";
import { emptyRegistryDeps } from "./registry-test-helpers.js";

function msg(seq: number, text: string): ChatMessage {
  return {
    id: `m${seq}`,
    sessionId: "s",
    seq,
    role: "user",
    content: { blocks: [{ type: "text", text }] },
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
  };
}

function ctxWith(overrides: {
  fingerprint?: string;
  messages?: readonly ChatMessage[];
}): PromptRenderContext {
  return {
    workplaceDisplay: "前缀正文".repeat(20),
    messages: overrides.messages ?? [msg(1, "你好世界")],
    workplaceFingerprint: overrides.fingerprint,
  };
}

function params(ctx: PromptRenderContext) {
  return {
    layout: { persist: [], dynamic: [] },
    ctx,
    savedModelId: "openai/gpt-4o",
    registry: createDefaultTokenCounterRegistry(emptyRegistryDeps()),
  };
}

describe("chat-token-estimate-memo（单元）", () => {
  beforeEach(() => clearChatTokenEstimateMemo());

  it("无 workplaceFingerprint → 键为 null（不缓存，宁可贵不陈旧）", () => {
    const key = buildChatTokenEstimateMemoKey({
      savedModelId: "m1",
      workplaceFingerprint: undefined,
      messages: [msg(1, "x")],
      tools: undefined,
    });
    assert.equal(key, null);
  });

  it("消息尾戳对内容长度敏感：同 seq 不同长度 → 不同键", () => {
    const a = stampMessagesForEstimateMemo([msg(1, "短")]);
    const b = stampMessagesForEstimateMemo([msg(1, "长长长长长长")]);
    assert.notEqual(a, b);
  });

  it("lookup 只吃逐字符相同的键；remember 覆盖旧条目", () => {
    assert.equal(lookupChatTokenEstimateMemo("s1", "k1"), null);
    rememberChatTokenEstimateMemo("s1", "k1", {
      tokenCount: 10,
      estimated: true,
      counterKind: "heuristic",
    });
    assert.equal(lookupChatTokenEstimateMemo("s1", "k2"), null);
    assert.equal(lookupChatTokenEstimateMemo("s1", "k1")?.tokenCount, 10);
    rememberChatTokenEstimateMemo("s1", "k1", {
      tokenCount: 20,
      estimated: false,
      counterKind: "tiktoken",
    });
    assert.equal(lookupChatTokenEstimateMemo("s1", "k1")?.tokenCount, 20);
  });
});

describe("chat-token-estimate-memo（resolve 集成）", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
    sessionApiPromptTokenCache.clearAll();
    clearChatTokenEstimateMemo();
  });

  it("同键估算二次调用：记忆在序列化之前命中，注入的精确档被原样吐出", async () => {
    const ctx = ctxWith({fingerprint: "fp-stable"});
    const key = buildChatTokenEstimateMemoKey({
      savedModelId: "openai/gpt-4o",
      workplaceFingerprint: "fp-stable",
      messages: ctx.messages,
      tools: undefined,
    });
    assert.ok(key != null);
    // 注入精确档（模拟「上一轮精确升级已完成」的记忆态）。
    rememberChatTokenEstimateMemo("sess-memo-1", key, {
      tokenCount: 424242,
      estimated: false,
      counterKind: "glm",
    });
    const result = await resolveCurrentPromptTokens(
      "sess-memo-1",
      params(ctx),
      { preferEstimate: true },
    );
    assert.equal(result.tokenCount, 424242, "记忆命中必须原样返回注入值");
    assert.equal(result.estimated, false);
    assert.equal(result.counterKind, "glm");
    assert.equal(result.source, "local");
  });

  it("估算 miss → 计算并记忆；消息变化 → 键变 → 重新计算", async () => {
    const first = await resolveCurrentPromptTokens(
      "sess-memo-2",
      params(ctxWith({fingerprint: "fp-2", messages: [msg(1, "一句话")]})),
      { preferEstimate: true },
    );
    assert.equal(first.estimated, true);
    assert.ok(first.tokenCount > 0);
    // 同键再调 → 记忆命中同值。
    const second = await resolveCurrentPromptTokens(
      "sess-memo-2",
      params(ctxWith({fingerprint: "fp-2", messages: [msg(1, "一句话")]})),
      { preferEstimate: true },
    );
    assert.deepEqual(second, first);
    // 消息内容变长 → 键变 → miss → 数值按新内容重算（CJK 感知，必然更大）。
    const third = await resolveCurrentPromptTokens(
      "sess-memo-2",
      params(
        ctxWith({
          fingerprint: "fp-2",
          messages: [msg(1, "一句话".repeat(200))],
        }),
      ),
      { preferEstimate: true },
    );
    assert.ok(third.tokenCount > first.tokenCount, "内容变了读数必须重算");
  });

  it("无指纹（旧路径）→ 记忆不参与：注入条目不会串值", async () => {
    const result = await resolveCurrentPromptTokens(
      "sess-memo-3",
      params(ctxWith({fingerprint: undefined})),
      { preferEstimate: true },
    );
    assert.equal(result.estimated, true, "无指纹路径走真估算");
    assert.notEqual(result.tokenCount, 424242);
  });

  it("精确分支完成 → 回写记忆 → 下一次估算帧直接拿精确档（升级语义）", async () => {
    const estimate = await resolveCurrentPromptTokens(
      "sess-memo-4",
      params(ctxWith({fingerprint: "fp-4"})),
      { preferEstimate: true },
    );
    assert.equal(estimate.estimated, true);
    // 完整口径（preferEstimate=false）：真分词器计数并回写记忆。
    const precise = await resolveCurrentPromptTokens(
      "sess-memo-4",
      params(ctxWith({fingerprint: "fp-4"})),
    );
    assert.equal(precise.estimated, false, "前提：完整口径出精确读数");
    const after = await resolveCurrentPromptTokens(
      "sess-memo-4",
      params(ctxWith({fingerprint: "fp-4"})),
      { preferEstimate: true },
    );
    assert.equal(
      after.estimated,
      false,
      "精确升级后的估算帧应命中记忆里的精确档（不锁死估算档）",
    );
    assert.equal(after.tokenCount, precise.tokenCount);
  });

  it("精确分支记忆预查：同键已有精确读数 → 直接复用（真机重复进入的 ~2s 残余归零）", async () => {
    const ctx = ctxWith({fingerprint: "fp-precise"});
    const key = buildChatTokenEstimateMemoKey({
      savedModelId: "openai/gpt-4o",
      workplaceFingerprint: "fp-precise",
      messages: ctx.messages,
      tools: undefined,
    });
    assert.ok(key != null);
    // 注入精确档：完整口径（preferEstimate 缺省 false）必须直接吐出注入值，
    // 而不是跑一遍真分词器计数（无预查时实算值 ≠ 999999，即红）。
    rememberChatTokenEstimateMemo("sess-memo-5", key, {
      tokenCount: 999999,
      estimated: false,
      counterKind: "tiktoken",
    });
    const result = await resolveCurrentPromptTokens(
      "sess-memo-5",
      params(ctx),
    );
    assert.equal(result.tokenCount, 999999);
    assert.equal(result.estimated, false);
    assert.equal(result.counterKind, "tiktoken");
  });

  it("精确分支预查只有估读时不拦截：升级照常真计数", async () => {
    const ctx = ctxWith({fingerprint: "fp-precise-est"});
    const key = buildChatTokenEstimateMemoKey({
      savedModelId: "openai/gpt-4o",
      workplaceFingerprint: "fp-precise-est",
      messages: ctx.messages,
      tools: undefined,
    });
    assert.ok(key != null);
    rememberChatTokenEstimateMemo("sess-memo-6", key, {
      tokenCount: 111,
      estimated: true,
      counterKind: "heuristic",
    });
    const result = await resolveCurrentPromptTokens(
      "sess-memo-6",
      params(ctx),
    );
    assert.equal(result.estimated, false, "完整口径必须出精确读数（估读不拦截）");
    assert.notEqual(result.tokenCount, 111);
  });
});
