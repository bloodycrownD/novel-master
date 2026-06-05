import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { registerNodeTokenizerDriverForTests } from "../helpers/register-node-tokenizer-driver-for-tests.js";
import { TokenRatioConditionTrigger } from "../../src/domain/compaction-conditions/triggers/token-ratio.trigger.js";
import {
  InMemoryAgentSession,
  countPromptLlmInput,
  createDefaultTokenCounterRegistry,
} from "@novel-master/core";
import type { PromptLlmInput } from "../../src/service/prompt/render-prompt.js";
import { emptyRegistryDeps } from "../infra/tokenizer/registry-test-helpers.js";

describe("TokenRatioConditionTrigger", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
  });

  it("does not fire below threshold or when context window is unknown", async () => {
    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const evaluation = {
      modelContext: {
        workspaceModelId: "openai/gpt-4o",
        applicationModelId: "openai/gpt-4o",
      },
      promptInput: { system: "sys", messages: [] } satisfies PromptLlmInput,
    };

    const below = new TokenRatioConditionTrigger(
      {
        tokenRatio: 0.8,
        resolveContextWindow: async () => 100_000,
      },
      registry,
    );
    assert.equal(await below.shouldTrigger(session, evaluation), false);

    assert.equal(
      await new TokenRatioConditionTrigger(
        {
          tokenRatio: 0.8,
          resolveContextWindow: async () => null,
        },
        registry,
      ).shouldTrigger(session, evaluation),
      false,
    );
  });

  it("ratio 0.8 × 100k: 85001 triggers", async () => {
    const session = new InMemoryAgentSession();
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const promptInput: PromptLlmInput = {
      system: "x".repeat(340_004),
      messages: [],
    };
    const evaluation = {
      modelContext: {
        workspaceModelId: "openai/test",
        applicationModelId: "openai/test",
      },
      promptInput,
    };
    const { tokenCount } = await countPromptLlmInput({
      input: promptInput,
      applicationModelId: "openai/test",
      registry,
    });
    assert.ok(tokenCount > 80_000);

    const trigger = new TokenRatioConditionTrigger(
      {
        tokenRatio: 0.8,
        resolveContextWindow: async () => 100_000,
      },
      registry,
    );
    assert.equal(await trigger.shouldTrigger(session, evaluation), true);
  });
});
