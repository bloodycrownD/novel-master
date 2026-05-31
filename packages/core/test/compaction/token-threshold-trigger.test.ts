import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TokenThresholdTrigger } from "../../src/domain/compaction/triggers/token-threshold.trigger.js";
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
    forApplicationModel: () => counter,
    forVendorModel: () => counter,
  };
}

describe("TokenThresholdTrigger", () => {
  it("C1: mock counter boundary at threshold", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("x"));

    const N = 100;
    const triggerAtN = new TokenThresholdTrigger(N, mockRegistry(N));
    const triggerBelow = new TokenThresholdTrigger(N - 1, mockRegistry(N));
    const ctx = { workspaceModelId: "openai/gpt-4o" };

    assert.equal(await triggerAtN.shouldCompact(session, ctx), false);
    assert.equal(await triggerBelow.shouldCompact(session, ctx), true);
  });
});
