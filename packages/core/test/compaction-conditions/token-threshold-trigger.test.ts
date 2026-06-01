import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TokenThresholdConditionTrigger } from "../../src/domain/compaction-conditions/triggers/token-threshold.trigger.js";
import { InMemoryAgentSession, textBlocks } from "@novel-master/core";
import type { TokenCounterRegistry } from "../../src/infra/tokenizer/ports/token-counter-registry.port.js";
import type { TokenCounter } from "../../src/infra/tokenizer/ports/token-counter.port.js";

function mockRegistry(fixedCount: number): TokenCounterRegistry {
  const counter: TokenCounter = {
    kind: "heuristic",
    countText: () => fixedCount,
    countMessages: () => fixedCount,
  };
  return {
    heuristic: counter,
    forApplicationModel: async () => counter,
    forVendorModel: () => counter,
  };
}

describe("TokenThresholdConditionTrigger", () => {
  it("fires when visible tokens exceed threshold", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("x"));

    const N = 100;
    const atThreshold = new TokenThresholdConditionTrigger(
      {
        tokenThreshold: N,
        resolveMaxContextTokens: async () => N,
      },
      mockRegistry(N),
    );
    const belowThreshold = new TokenThresholdConditionTrigger(
      {
        tokenThreshold: N - 1,
        resolveMaxContextTokens: async () => N,
      },
      mockRegistry(N),
    );
    const ctx = { applicationModelId: "openai/gpt-4o" };

    assert.equal(await atThreshold.shouldTrigger(session, ctx), false);
    assert.equal(await belowThreshold.shouldTrigger(session, ctx), true);
  });
});
