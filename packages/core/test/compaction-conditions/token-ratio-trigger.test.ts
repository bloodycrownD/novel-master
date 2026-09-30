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

  it("无统计可用时评估走 heuristic 估算、不调驱动（preferEstimate，T5 改版）", async () => {
    const captured: { driverCalled: number } = { driverCalled: 0 };
    clearTokenizerDrivers();
    setNodeTokenizerLoader(
      createNodeTokenizerLoader(defaultTokenizerAssetsRoot()),
    );
    registerTokenizerDriver({
      name: NODE_DRIVER_NAME,
      countPromptLlmInput: async (params) => {
        captured.driverCalled += 1;
        return nodeCountPromptLlmInput(params);
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
    // 评估路径估算优先：读口 heuristic 即回，驱动（真分词器）一次都不被调
    // ——压缩判定不得为本地计数阻塞 run（glm 原生整串 ~5.8s）。
    assert.equal(captured.driverCalled, 0, "评估的本地分支不得调驱动");
  });

  it("heuristic 估算走保守阈值，比 api 精确档更早触发压缩", async () => {
    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const sessionKkv = createMemorySessionKkv();
    // 注入通道 = 正文本身（2026-09-30 起估算读数改「单趟 CJK 感知字符折算」，
    // 不再经 registry.heuristic.countText —— 往计数器里塞数已无效）。45_122 个
    // 汉字 × 1.64 ≈ 74_000 token，稳落「保守阈值 68_000 之上、精确阈值 80_000
    // 之下」的区间（区间宽 12_000，取值不贴边）。
    const bandText = "中".repeat(45_122);
    const evaluation = systemOnlyEvaluation(
      bandText,
      "sess-heuristic-factor",
      sessionKkv
    );

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

    assert.equal(
      await makeTrigger().shouldTrigger(session, evaluation),
      true,
      "heuristic 估算（估算优先路径的必然档位）必须走保守阈值",
    );
    // safetyFactor=1 时退化回精确阈值，不再提前触发。
    assert.equal(await makeTrigger(1).shouldTrigger(session, evaluation), false);

    // 对照：同数值走 api 精确档（counterKind=api）不乘系数 → 不触发。
    await seedKkvEntry(sessionKkv, "sess-heuristic-factor", 75_000);
    assert.equal(
      await makeTrigger().shouldTrigger(session, evaluation),
      false,
      "api 基线命中时不乘保守系数",
    );
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
