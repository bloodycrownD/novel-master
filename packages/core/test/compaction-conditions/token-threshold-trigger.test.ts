import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TokenThresholdConditionTrigger } from "../../src/domain/compaction-conditions/triggers/token-threshold.trigger.js";
import {
  InMemoryAgentSession,
  textBlocks,
  countPromptLlmInput,
  createDefaultTokenCounterRegistry,
} from "@novel-master/core";
import type { PromptLlmInput } from "../../src/service/prompt/render-prompt.js";
import { emptyRegistryDeps } from "../infra/tokenizer/registry-test-helpers.js";

const promptInput: PromptLlmInput = {
  system: "sys",
  messages: [],
};

describe("TokenThresholdConditionTrigger", () => {
  it("fires when prompt tokens exceed threshold", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("x"));
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const evaluation = {
      modelContext: {
        workspaceModelId: "openai/gpt-4o",
        applicationModelId: "openai/gpt-4o",
      },
      promptInput,
    };
    const { tokenCount: N } = await countPromptLlmInput({
      input: promptInput,
      applicationModelId: "openai/gpt-4o",
      registry,
    });

    const atThreshold = new TokenThresholdConditionTrigger(
      {
        tokenThreshold: N,
        resolveMaxContextTokens: async () => N,
      },
      registry,
    );
    const belowThreshold = new TokenThresholdConditionTrigger(
      {
        tokenThreshold: N - 1,
        resolveMaxContextTokens: async () => N,
      },
      registry,
    );

    assert.equal(await atThreshold.shouldTrigger(session, evaluation), false);
    assert.equal(await belowThreshold.shouldTrigger(session, evaluation), true);
  });
});
