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
import { InMemoryAgentSession } from "@novel-master/core/agent";

import { countPromptLlmInput, createDefaultTokenCounterRegistry } from "@novel-master/core/provider";
import type { AgentPromptLayout } from "../../src/domain/prompt/model/agent-prompt-layout.js";
import type { PromptRenderContext } from "../../src/domain/prompt/model/prompt-render-context.js";
import { emptyRegistryDeps } from "../infra/tokenizer/registry-test-helpers.js";

function systemOnlyEvaluation(systemContent: string) {
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
    sessionId: "sess-token-ratio",
    modelContext: {
      workspaceModelId: "openai/gpt-4o",
      savedModelId: "openai/gpt-4o",
    },
    promptInput: { system: systemContent, messages: [] },
    layout,
    ctx,
  };
}

describe("TokenRatioConditionTrigger", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
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

  it("ratio 0.8 × 100k: 85001 triggers", async () => {
    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const evaluation = {
      ...systemOnlyEvaluation("x".repeat(340_004)),
      modelContext: {
        workspaceModelId: "openai/test",
        savedModelId: "openai/test",
      },
    };
    const { tokenCount } = await countPromptLlmInput({
      layout: evaluation.layout,
      ctx: evaluation.ctx,
      savedModelId: evaluation.modelContext.savedModelId,
      registry,
    });
    assert.ok(tokenCount > 80_000);

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

  it("85000 tokens at effective threshold does not trigger (strict >)", async () => {
    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const evaluation = systemOnlyEvaluation("x".repeat(340_000));
    const { tokenCount } = await countPromptLlmInput({
      layout: evaluation.layout,
      ctx: evaluation.ctx,
      savedModelId: "openai/test",
      registry,
    });
    const contextWindow = tokenCount / 0.8;
    assert.equal(Math.floor(contextWindow * 0.8), tokenCount);

    const trigger = new TokenRatioConditionTrigger(
      {
        tokenRatio: 0.8,
        resolveContextWindow: async () => contextWindow,
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
    const captured: { counterKind?: string; tokenCount?: number } = {};
    clearTokenizerDrivers();
    registerTokenizerDriver({
      name: "mock",
      countPromptLlmInput: async () => ({
        tokenCount: captured.tokenCount ?? 0,
        counterKind: (captured.counterKind ?? "tiktoken") as never,
        estimated: captured.counterKind === "heuristic",
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
  });
});
