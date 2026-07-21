/**
 * T-T1 / T-T2 / T-T3 / T-T9：pickLastPromptUsage + resolveCurrentPromptTokens。
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { registerNodeTokenizerDriverForTests } from "../../helpers/register-node-tokenizer-driver-for-tests.js";
import type { ModelRoundSummary } from "../../../src/domain/agent/model/agent-run-result.js";
import {
  createDefaultTokenCounterRegistry,
  pickLastPromptUsage,
  resolveCurrentPromptTokens,
  sessionApiPromptTokenCache,
} from "../../../src/infra/tokenizer/index.js";
import { emptyRegistryDeps } from "./registry-test-helpers.js";

const SESSION_ID = "sess-token-resolve";

function round(
  partial: Partial<ModelRoundSummary> & Pick<ModelRoundSummary, "step">,
): ModelRoundSummary {
  return {
    hadToolUse: false,
    finished: false,
    ...partial,
  };
}

describe("pickLastPromptUsage / resolveCurrentPromptTokens", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
    sessionApiPromptTokenCache.clearAll();
  });

  afterEach(() => {
    sessionApiPromptTokenCache.clearAll();
  });

  it("T-T1: 末轮无 prompt、中间轮有 → pick 中间最后有值者", () => {
    const rounds: ModelRoundSummary[] = [
      round({ step: 0, usage: { promptTokens: 100 } }),
      round({ step: 1, usage: { promptTokens: 250 } }),
      round({ step: 2, usage: { completionTokens: 10 } }),
    ];
    assert.equal(pickLastPromptUsage(rounds), 250);
  });

  it("T-T2: promptTokens: 0 视为可用", () => {
    const rounds: ModelRoundSummary[] = [
      round({ step: 0, usage: { promptTokens: 0 } }),
    ];
    assert.equal(pickLastPromptUsage(rounds), 0);
  });

  it("T-T3: usage 全缺 → resolve 走 local", async () => {
    const rounds: ModelRoundSummary[] = [
      round({ step: 0 }),
      round({ step: 1, usage: { completionTokens: 3 } }),
    ];
    assert.equal(pickLastPromptUsage(rounds), undefined);

    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const resolved = await resolveCurrentPromptTokens(SESSION_ID, {
      layout: { persist: [], dynamic: [] },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: "openai/gpt-4o",
      registry,
    });
    assert.equal(resolved.source, "local");
    assert.notEqual(resolved.counterKind, "api");
    assert.ok(resolved.tokenCount >= 0);
  });

  it("T-T9: source===api ⇒ estimated===false && counterKind===api", async () => {
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 1234,
      updatedAt: Date.now(),
    });
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const resolved = await resolveCurrentPromptTokens(SESSION_ID, {
      layout: { persist: [], dynamic: [] },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: "openai/gpt-4o",
      registry,
    });
    assert.equal(resolved.source, "api");
    assert.equal(resolved.tokenCount, 1234);
    assert.equal(resolved.estimated, false);
    assert.equal(resolved.counterKind, "api");
  });

  it("T-T6: invalidate 后回退 local", async () => {
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 999,
      updatedAt: Date.now(),
    });
    sessionApiPromptTokenCache.invalidate(SESSION_ID);
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const resolved = await resolveCurrentPromptTokens(SESSION_ID, {
      layout: { persist: [], dynamic: [] },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: "openai/gpt-4o",
      registry,
    });
    assert.equal(resolved.source, "local");
  });
});
