/**
 * chip 估算读数的进程内记忆（2026-09-30「切会话重算」治本回归锁）。
 *
 * 核心断言面：
 * - 记忆在 resolve 估算分支**序列化之前**被 consulted——注入精确档条目后，
 *   同键估算调用必须原样吐出注入值（删掉记忆查找即红：会回落真估算值）；
 * - 无 workplaceFingerprint 不缓存（键为 null，注入不生效）；
 * - 消息变了键就变（miss → 重算，防陈旧）；layout（agent 定义）变了键也变
 *   （r4-core-1：旧键读数对新布局必 miss）；
 * - 精确分支完成时回写记忆——下一次估算帧拿到精确档（升级语义，与
 *   「preferEstimate 先查 L1」同精神）；估算写不覆盖同键精确档（r4-core-3）；
 * - memo 按会话数 64 条截断（r4q-5）。
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
  rememberWorkplaceEstimateByFingerprint,
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

/**
 * 空三区 layout（键构造与被测参数必须同源——两边各建一份等值对象，
 * 摘要逐字符相同）。
 */
function layoutOf(
  overrides: {system?: string; workplace?: string} = {},
) {
  return {persist: [], dynamic: [], ...overrides};
}

function params(
  ctx: PromptRenderContext,
  layout: {system?: string; workplace?: string} = {},
) {
  return {
    layout: layoutOf(layout),
    ctx,
    savedModelId: "openai/gpt-4o",
    registry: createDefaultTokenCounterRegistry(emptyRegistryDeps()),
  };
}

/** 与被测参数同源的记忆键（走 buildChatTokenEstimateMemoKey 公开入口）。 */
function keyOf(
  ctx: PromptRenderContext,
  layout: {system?: string; workplace?: string} = {},
): string | null {
  return buildChatTokenEstimateMemoKey({
    savedModelId: "openai/gpt-4o",
    workplaceFingerprint: ctx.workplaceFingerprint,
    messages: ctx.messages,
    tools: undefined,
    layout: layoutOf(layout),
  });
}

describe("chat-token-estimate-memo（单元）", () => {
  beforeEach(() => clearChatTokenEstimateMemo());

  it("无 workplaceFingerprint → 键为 null（不缓存，宁可贵不陈旧）", () => {
    const key = keyOf(ctxWith({fingerprint: undefined}));
    assert.equal(key, null);
  });

  it("无 layout → 键为 null（没有布局摘要就没有「产物没变」的判定依据）", () => {
    const key = buildChatTokenEstimateMemoKey({
      savedModelId: "m1",
      workplaceFingerprint: "fp",
      messages: [msg(1, "x")],
      tools: undefined,
      layout: undefined,
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

  it("仅 layout.system 变 ⇒ 键必变，旧键读数对新布局 lookup 必 miss（r4-core-1）", async () => {
    const ctx = ctxWith({fingerprint: "fp-layout"});
    const keyA = keyOf(ctx, {system: "初版人设"});
    const keyB = keyOf(ctx, {system: "改版人设"});
    assert.ok(keyA != null && keyB != null);
    const segA = keyA.split("|");
    const segB = keyB.split("|");
    assert.deepEqual(
      segA.slice(0, 4),
      segB.slice(0, 4),
      "前提：模型/指纹/消息尾戳/tools 四段逐字相同，只有 layout 段可变",
    );
    assert.notEqual(segA[4], segB[4], "layout 摘要段必须随 system 变");
    assert.notEqual(keyA, keyB);
    // 编辑前落地的读数（精确档）不得被编辑后的布局读到。
    rememberChatTokenEstimateMemo("sess-layout", keyA, {
      tokenCount: 424242,
      estimated: false,
      counterKind: "tiktoken",
    });
    assert.equal(
      lookupChatTokenEstimateMemo("sess-layout", keyB),
      null,
      "layout 变后 lookup 必须 miss（旧实现键不含 layout，这里会命中 424242）",
    );
    assert.equal(lookupChatTokenEstimateMemo("sess-layout", keyA)?.tokenCount, 424242);
    // 调用方真的把 layout 传进了键：resolve 回写的条目落在含 layout 的新键上。
    const fresh = await resolveCurrentPromptTokens(
      "sess-layout",
      params(ctx, {system: "改版人设"}),
      { preferEstimate: true },
    );
    assert.notEqual(fresh.tokenCount, 424242, "估算读数不得复用编辑前旧键值");
    assert.ok(
      lookupChatTokenEstimateMemo("sess-layout", keyB) != null,
      "resolve 必须按含 layout 摘要的键回写（调用方漏传 layout 时键为 null、这里即红）",
    );
  });

  it("同键下估算写不覆盖已落地的精确档（r4-core-3 升级单向）", () => {
    rememberChatTokenEstimateMemo("s1", "k", {
      tokenCount: 20,
      estimated: false,
      counterKind: "tiktoken",
    });
    // 起于精确写之前、落于其后的估算写：必须保留既有精确档。
    rememberChatTokenEstimateMemo("s1", "k", {
      tokenCount: 10,
      estimated: true,
      counterKind: "heuristic",
    });
    const hit = lookupChatTokenEstimateMemo("s1", "k");
    assert.equal(hit?.tokenCount, 20, "估算档不得覆盖同键精确档");
    assert.equal(hit?.estimated, false);
    assert.equal(hit?.counterKind, "tiktoken");
    // 反向（估算 → 精确）仍是允许的升级；同档覆盖照常生效。
    rememberChatTokenEstimateMemo("s1", "k", {
      tokenCount: 30,
      estimated: false,
      counterKind: "tiktoken",
    });
    assert.equal(lookupChatTokenEstimateMemo("s1", "k")?.tokenCount, 30);
    // 键变了（内容变了）⇒ 守卫不适用，新键照常入册（不锁死旧档）。
    rememberChatTokenEstimateMemo("s1", "k2", {
      tokenCount: 7,
      estimated: true,
      counterKind: "heuristic",
    });
    const after = lookupChatTokenEstimateMemo("s1", "k2");
    assert.equal(after?.tokenCount, 7);
    assert.equal(after?.estimated, true);
  });

  it("memo 按会话数截断：第 65 个会话挤掉最旧插入序（r4q-5）", () => {
    for (let i = 0; i < 64; i += 1) {
      rememberChatTokenEstimateMemo(`sess-${i}`, "k", {
        tokenCount: i + 1,
        estimated: true,
        counterKind: "heuristic",
      });
    }
    assert.ok(
      lookupChatTokenEstimateMemo("sess-0", "k") != null,
      "前提：写满 64 条时上界未到，最旧会话仍在册",
    );
    rememberChatTokenEstimateMemo("sess-64", "k", {
      tokenCount: 64,
      estimated: true,
      counterKind: "heuristic",
    });
    assert.equal(
      lookupChatTokenEstimateMemo("sess-0", "k"),
      null,
      "第 65 个会话入册必须逐出最旧插入序",
    );
    assert.ok(lookupChatTokenEstimateMemo("sess-1", "k") != null);
    assert.ok(lookupChatTokenEstimateMemo("sess-64", "k") != null);
    // 已有会话的覆盖写不触发逐出（不误伤在册会话）。
    rememberChatTokenEstimateMemo("sess-1", "k2", {
      tokenCount: 1,
      estimated: true,
      counterKind: "heuristic",
    });
    assert.ok(
      lookupChatTokenEstimateMemo("sess-2", "k") != null,
      "覆盖写不得挤出别的会话",
    );
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
    const key = keyOf(ctx);
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
    const key = keyOf(ctx);
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
    const key = keyOf(ctx);
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

  it("增量分解：workplace 估读按指纹缓存并被采用（注入值=牙齿），只现算消息段", async () => {
    const ctx = ctxWith({fingerprint: "fp-inc"});
    // 注入夸张的指纹估读：分解路径必须采用缓存值（删掉 lookup 即现算真值
    // ≠ 注入值，断言即红）。layout 带 workplace 块（render 门控对齐）。
    rememberWorkplaceEstimateByFingerprint("fp-inc", 12345);
    const result = await resolveCurrentPromptTokens(
      "sess-inc",
      params(ctx, {workplace: "【工作区】"}),
      { preferEstimate: true },
    );
    // 结果 = 12345 + 消息/system/tools/合成对包装段的小额估读。
    assert.ok(
      result.tokenCount >= 12345 && result.tokenCount < 12400,
      `分解估读应采用注入的指纹缓存值（got ${result.tokenCount}）`,
    );
    // 跨会话共享：另一个会话同指纹不再重算 workplace 段（结果同值口径）。
    const other = await resolveCurrentPromptTokens(
      "sess-inc-2",
      params(ctxWith({fingerprint: "fp-inc"}), {workplace: "【工作区】"}),
      { preferEstimate: true },
    );
    assert.ok(other.tokenCount >= 12345 && other.tokenCount < 12400);
  });

  it("增量分解与整串估算口径一致（哨兵替换法，差值 ≤ 各段 ceil 常数）", async () => {
    const wpLayout = {workplace: "【工作区】"};
    const decomposed = await resolveCurrentPromptTokens(
      "sess-parity-a",
      params(ctxWith({fingerprint: "fp-parity"}), wpLayout),
      { preferEstimate: true },
    );
    const whole = await resolveCurrentPromptTokens(
      "sess-parity-b",
      params(ctxWith({fingerprint: undefined}), wpLayout),
      { preferEstimate: true },
    );
    assert.ok(
      Math.abs(decomposed.tokenCount - whole.tokenCount) <= 2,
      `分解口径偏差 ${decomposed.tokenCount - whole.tokenCount} 应在 ceil 常数内`,
    );
  });
});
