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
});
