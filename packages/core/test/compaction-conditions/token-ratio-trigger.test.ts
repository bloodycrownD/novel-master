import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { registerNodeTokenizerDriverForTests } from "../helpers/register-node-tokenizer-driver-for-tests.js";
import {
  clearTokenizerDrivers,
  registerTokenizerDriver,
} from "../../src/infra/nmtp/index.js";
import { countPromptLlmInput as nodeCountPromptLlmInput } from "../../../tokenizer-driver-node/src/count-prompt-llm-input.js";
import {
  createNodeTokenizerLoader,
  defaultTokenizerAssetsRoot,
  setNodeTokenizerLoader,
} from "../../../tokenizer-driver-node/src/node-tokenizer-loader.js";
import { NODE_DRIVER_NAME } from "../../../tokenizer-driver-node/src/register.js";
import { TokenRatioConditionTrigger } from "../../src/domain/compaction-conditions/triggers/token-ratio.trigger.js";
import { sessionApiPromptTokenCache } from "../../src/infra/tokenizer/logic/session-api-prompt-token-cache.js";
import { serializeSessionApiPromptTokenEntry } from "../../src/infra/tokenizer/logic/session-api-prompt-token-store.js";
import {
  PROMPT_TOKENS_LAST_USAGE_KEY,
  SESSION_KKV_DOMAIN_PROMPT_TOKENS,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import type { SessionKkvService } from "../../src/service/session-kkv/session-kkv.port.js";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import { InMemoryAgentSession } from "@novel-master/core/agent";

import { createDefaultTokenCounterRegistry } from "@novel-master/core/provider";
import type { AgentPromptLayout } from "../../src/domain/prompt/model/agent-prompt-layout.js";
import type { PromptRenderContext } from "../../src/domain/prompt/model/prompt-render-context.js";
import { emptyRegistryDeps } from "../infra/tokenizer/registry-test-helpers.js";

function systemOnlyEvaluation(
  systemContent: string,
  sessionId = "sess-token-ratio",
  sessionKkv: SessionKkvService = createMemorySessionKkv()
) {
  const layout: AgentPromptLayout = {
    system: systemContent,
    persist: [],
    dynamic: [],
  };
  const ctx: PromptRenderContext = {
    workplaceDisplay: "",
    messages: [],
  };
  return {
    sessionId,
    modelContext: {
      workspaceModelId: "openai/gpt-4o",
      savedModelId: "openai/gpt-4o",
    },
    promptInput: { system: systemContent, messages: [] },
    layout,
    ctx,
    sessionKkv,
  };
}

/** 直接落一条 API 占用到 KKV（模拟上一轮 completed run 的落库值）。 */
function seedKkvEntry(
  sessionKkv: SessionKkvService,
  sessionId: string,
  promptTokens: number
): Promise<void> {
  return sessionKkv.set(
    sessionId,
    SESSION_KKV_DOMAIN_PROMPT_TOKENS,
    PROMPT_TOKENS_LAST_USAGE_KEY,
    serializeSessionApiPromptTokenEntry({
      promptTokens,
      atMs: Date.now(),
      savedModelId: "openai/gpt-4o",
    })
  );
}

describe("TokenRatioConditionTrigger", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
    sessionApiPromptTokenCache.clearAll();
  });

  it("does not fire below threshold or when context window is unknown", async () => {
    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const evaluation = systemOnlyEvaluation("sys");

    const below = new TokenRatioConditionTrigger(
      {
        tokenRatio: 0.8,
        resolveContextWindow: async () => 100_000,
        resolveTokenizerOverride: async () => "auto",
      },
      registry,
    );
    assert.equal(await below.shouldTrigger(session, evaluation), false);

    assert.equal(
      await new TokenRatioConditionTrigger(
        {
          tokenRatio: 0.8,
          resolveContextWindow: async () => null,
          resolveTokenizerOverride: async () => "auto",
        },
        registry,
      ).shouldTrigger(session, evaluation),
      false,
    );
  });

  it("fires when token count exceeds floor(contextWindow × ratio)", async () => {
    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const evaluation = systemOnlyEvaluation("(small)", "sess-above-threshold");

    // Prime the API cache so resolveCurrentPromptTokens skips the real tokenizer.
    // threshold = floor(100_000 × 0.8) = 80_000; 85_001 > 80_000 → fires.
    sessionApiPromptTokenCache.set("sess-above-threshold", {
      promptTokens: 85_001,
      updatedAt: Date.now(),
    });

    const trigger = new TokenRatioConditionTrigger(
      {
        tokenRatio: 0.8,
        resolveContextWindow: async () => 100_000,
        resolveTokenizerOverride: async () => "auto",
      },
      registry,
    );
    assert.equal(await trigger.shouldTrigger(session, evaluation), true);
  });

  it("does not fire when token count equals threshold (strict >)", async () => {
    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const evaluation = systemOnlyEvaluation("(small)", "sess-at-threshold");

    // threshold = floor(100_000 × 0.8) = 80_000; 80_000 > 80_000 → false (strict >).
    sessionApiPromptTokenCache.set("sess-at-threshold", {
      promptTokens: 80_000,
      updatedAt: Date.now(),
    });

    const trigger = new TokenRatioConditionTrigger(
      {
        tokenRatio: 0.8,
        resolveContextWindow: async () => 100_000,
        resolveTokenizerOverride: async () => "auto",
      },
      registry,
    );
    assert.equal(await trigger.shouldTrigger(session, evaluation), false);
  });

  it("uses heuristic override when resolveTokenizerOverride returns heuristic (T5)", async () => {
    const captured: { tokenizerOverride?: string; counterKind?: string } = {};
    clearTokenizerDrivers();
    setNodeTokenizerLoader(
      createNodeTokenizerLoader(defaultTokenizerAssetsRoot()),
    );
    registerTokenizerDriver({
      name: NODE_DRIVER_NAME,
      countPromptLlmInput: async (params) => {
        const result = await nodeCountPromptLlmInput(params);
        captured.tokenizerOverride = params.tokenizerOverride;
        captured.counterKind = result.counterKind;
        return result;
      },
    });

    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const evaluation = systemOnlyEvaluation("hello world");

    const trigger = new TokenRatioConditionTrigger(
      {
        tokenRatio: 0.8,
        resolveContextWindow: async () => 100_000,
        resolveTokenizerOverride: async () => "heuristic",
      },
      registry,
    );

    await trigger.shouldTrigger(session, evaluation);
    assert.equal(captured.tokenizerOverride, "heuristic");
    assert.equal(captured.counterKind, "heuristic");
  });

  it("heuristic 计数走保守阈值，比精确档更早触发压缩", async () => {
    // 用 mock driver 可控返回 counterKind / tokenCount，避免依赖真实 tokenizer 数值。
    const captured: {
      counterKind?: string;
      tokenCount?: number;
      estimated?: boolean;
    } = {};
    clearTokenizerDrivers();
    registerTokenizerDriver({
      name: "mock",
      countPromptLlmInput: async () => ({
        tokenCount: captured.tokenCount ?? 0,
        counterKind: (captured.counterKind ?? "tiktoken") as never,
        estimated: captured.estimated ?? captured.counterKind === "heuristic",
        savedModelId: "openai/test",
        vendorModelId: "openai/test",
        tokenizerFamily: "heuristic",
      }),
    });

    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const evaluation = systemOnlyEvaluation("sys");

    // contextWindow=100000、tokenRatio=0.8：精确阈值=80000，heuristic 默认阈值=68000。
    const makeTrigger = (heuristicSafetyFactor?: number) =>
      new TokenRatioConditionTrigger(
        {
          tokenRatio: 0.8,
          resolveContextWindow: async () => 100_000,
          resolveTokenizerOverride: async () => "auto",
          heuristicSafetyFactor,
        },
        registry,
      );

    // 75000 落在「保守阈值之上、精确阈值之下」区间。
    captured.tokenCount = 75_000;

    captured.counterKind = "tiktoken";
    assert.equal(await makeTrigger().shouldTrigger(session, evaluation), false);

    captured.counterKind = "heuristic";
    assert.equal(await makeTrigger().shouldTrigger(session, evaluation), true);

    // safetyFactor=1 时 heuristic 退化回精确阈值，不再提前触发。
    assert.equal(
      await makeTrigger(1).shouldTrigger(session, evaluation),
      false,
    );

    // 统计优先（2026-09-29）：估算档（estimated:true，如 WEB/SP 家族被读口
    // 强制的 cl100k 档）即使 counterKind 不是 heuristic 也必须乘保守系数——
    // cl100k 对非 OpenAI 家族只是近似，可能低估。
    captured.counterKind = "tiktoken";
    captured.estimated = true;
    assert.equal(
      await makeTrigger().shouldTrigger(session, evaluation),
      true,
      "estimated:true 的估算档必须走保守阈值"
    );
    assert.equal(await makeTrigger(1).shouldTrigger(session, evaluation), false);
    captured.estimated = undefined;
  });

  it("KKV 命中（跨重启）：进程内热层空时仍按 API 值判定", async () => {
    const sessionKkv = createMemorySessionKkv();
    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const evaluation = systemOnlyEvaluation(
      "(tiny)",
      "sess-kkv-hit",
      sessionKkv
    );

    // 上一轮 completed run 落库的 API 值：threshold = floor(100_000×0.8)=80_000，
    // 85_001 > 80_000 → 触发。若 KKV 未被读到，本地字符估算只有个位数 → 不触发。
    await seedKkvEntry(sessionKkv, "sess-kkv-hit", 85_001);
    sessionApiPromptTokenCache.clearAll(); // 模拟重启：只留 KKV

    const trigger = new TokenRatioConditionTrigger(
      {
        tokenRatio: 0.8,
        resolveContextWindow: async () => 100_000,
        resolveTokenizerOverride: async () => "auto",
      },
      registry,
    );
    assert.equal(await trigger.shouldTrigger(session, evaluation), true);
  });

  it("API 口径（counterKind=api）不乘 heuristic 安全系数", async () => {
    const sessionKkv = createMemorySessionKkv();
    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const evaluation = systemOnlyEvaluation(
      "(tiny)",
      "sess-api-no-factor",
      sessionKkv
    );

    // 75_000 落在「heuristic 保守阈值 68_000 之上、精确阈值 80_000 之下」：
    // 按 api 口径（safetyFactor=1）→ 不触发；若被误当 heuristic → 会触发。
    await seedKkvEntry(sessionKkv, "sess-api-no-factor", 75_000);
    sessionApiPromptTokenCache.clearAll();

    const trigger = new TokenRatioConditionTrigger(
      {
        tokenRatio: 0.8,
        resolveContextWindow: async () => 100_000,
        resolveTokenizerOverride: async () => "auto",
      },
      registry,
    );
    assert.equal(await trigger.shouldTrigger(session, evaluation), false);
  });

  it("指纹不符（KKV 值属于别的模型）→ 当 miss 走本地估算", async () => {
    const sessionKkv = createMemorySessionKkv();
    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const evaluation = systemOnlyEvaluation(
      "(tiny)",
      "sess-fingerprint-miss",
      sessionKkv
    );

    await sessionKkv.set(
      "sess-fingerprint-miss",
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY,
      serializeSessionApiPromptTokenEntry({
        promptTokens: 99_999,
        atMs: Date.now(),
        savedModelId: "anthropic/claude-other",
      })
    );
    sessionApiPromptTokenCache.clearAll();

    const trigger = new TokenRatioConditionTrigger(
      {
        tokenRatio: 0.8,
        resolveContextWindow: async () => 100_000,
        resolveTokenizerOverride: async () => "auto",
      },
      registry,
    );
    // 不采用 99_999（否则必触发）；本地估算 + heuristic 安全系数下也不会触发。
    assert.equal(await trigger.shouldTrigger(session, evaluation), false);
  });
});
