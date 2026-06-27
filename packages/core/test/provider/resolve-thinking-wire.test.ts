import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEffectiveMaxTokens,
  resolveThinkingParamsForLevel,
} from "../../src/domain/provider/logic/resolve-thinking-wire.js";

describe("resolve-thinking-wire", () => {
  it("resolveEffectiveMaxTokens 在无采样时使用协议默认", () => {
    assert.equal(resolveEffectiveMaxTokens({ enabled: false }, "anthropic"), 4096);
  });

  it("off 档位返回 undefined", () => {
    assert.equal(
      resolveThinkingParamsForLevel("off", "openai", { enabled: false }, "gpt-4o"),
      undefined,
    );
  });

  it("medium 档位 OpenAI 解析为 reasoning_effort medium", () => {
    assert.deepEqual(
      resolveThinkingParamsForLevel("medium", "openai", { enabled: false }, "gpt-4o"),
      { protocol: "openai", openai: { reasoning_effort: "medium" } },
    );
  });

  it("Anthropic budget 小于 effective max_tokens", () => {
    const params = resolveThinkingParamsForLevel(
      "medium",
      "anthropic",
      { enabled: false },
      "claude-3-5-sonnet",
    );
    const effective = resolveEffectiveMaxTokens({ enabled: false }, "anthropic");
    assert.equal(params?.protocol, "anthropic");
    if (params?.protocol === "anthropic") {
      assert.ok(params.anthropic.budget_tokens < effective);
    }
  });

  it("Gemini 2.5 medium 使用 thinkingBudget -1", () => {
    const params = resolveThinkingParamsForLevel(
      "medium",
      "gemini",
      { enabled: false },
      "gemini-2.5-flash",
    );
    if (params?.protocol === "gemini") {
      assert.equal(params.gemini.thinkingConfig.thinkingBudget, -1);
    }
  });

  it("Gemini 3.x medium 使用 thinkingLevel medium", () => {
    const params = resolveThinkingParamsForLevel(
      "medium",
      "gemini",
      { enabled: false },
      "gemini-3-pro",
    );
    if (params?.protocol === "gemini") {
      assert.equal(params.gemini.thinkingConfig.thinkingLevel, "medium");
    }
  });
});
