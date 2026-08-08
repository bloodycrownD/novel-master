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
import { InMemoryAgentSession } from "@novel-master/core/agent";

import { createDefaultTokenCounterRegistry } from "@novel-master/core/provider";
import type { AgentPromptLayout } from "../../src/domain/prompt/model/agent-prompt-layout.js";
import type { PromptRenderContext } from "../../src/domain/prompt/model/prompt-render-context.js";
import { emptyRegistryDeps } from "../infra/tokenizer/registry-test-helpers.js";

function systemOnlyEvaluation(systemContent: string, sessionId = "sess-token-ratio") {
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
  };
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
});
