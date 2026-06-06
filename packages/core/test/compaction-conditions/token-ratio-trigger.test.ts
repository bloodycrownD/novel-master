import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { registerNodeTokenizerDriverForTests } from "../helpers/register-node-tokenizer-driver-for-tests.js";
import { TokenRatioConditionTrigger } from "../../src/domain/compaction-conditions/triggers/token-ratio.trigger.js";
import {
  InMemoryAgentSession,
  countPromptLlmInput,
  createDefaultTokenCounterRegistry,
} from "@novel-master/core";
import type { PromptBlock } from "../../src/domain/prompt/model/prompt-block.js";
import type { PromptRenderContext } from "../../src/service/prompt/render-prompt.js";
import { emptyRegistryDeps } from "../infra/tokenizer/registry-test-helpers.js";

function systemOnlyEvaluation(systemContent: string) {
  const blocks: PromptBlock[] = [
    { name: "s", type: "text", role: "system", content: systemContent },
  ];
  const ctx: PromptRenderContext = {
    worktreeDisplay: "",
    filetreeDisplay: "",
    messages: [],
  };
  return {
    modelContext: {
      workspaceModelId: "openai/gpt-4o",
      applicationModelId: "openai/gpt-4o",
    },
    promptInput: { system: systemContent, messages: [] },
    blocks,
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
        applicationModelId: "openai/test",
      },
    };
    const { tokenCount } = await countPromptLlmInput({
      blocks: evaluation.blocks,
      ctx: evaluation.ctx,
      applicationModelId: evaluation.modelContext.applicationModelId,
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
      blocks: evaluation.blocks,
      ctx: evaluation.ctx,
      applicationModelId: "openai/test",
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

  it("uses heuristic override when resolveTokenizerOverride returns heuristic", async () => {
    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const evaluation = systemOnlyEvaluation("hello world");
    const { counterKind } = await countPromptLlmInput({
      blocks: evaluation.blocks,
      ctx: evaluation.ctx,
      applicationModelId: evaluation.modelContext.applicationModelId,
      registry,
      tokenizerOverride: "heuristic",
    });
    assert.equal(counterKind, "heuristic");

    const trigger = new TokenRatioConditionTrigger(
      {
        tokenRatio: 0.00001,
        resolveContextWindow: async () => 1_000_000,
        resolveTokenizerOverride: async () => "heuristic",
      },
      registry,
    );
    assert.equal(await trigger.shouldTrigger(session, evaluation), true);
  });
});
