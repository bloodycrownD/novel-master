import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveEffectiveMaxTokens } from "../../src/domain/provider/logic/resolve-thinking-wire.js";
import { thinkingLevelToModelThinkingParams } from "../../src/domain/provider/logic/thinking-level-presets.js";

describe("resolve-thinking-wire", () => {
  it("resolveEffectiveMaxTokens 在无采样时使用协议默认", () => {
    // 修复前是硬写的 4096（与 UI 采样默认值 16000 各写一份、互不知情）。
    assert.equal(resolveEffectiveMaxTokens({ enabled: false }, "anthropic"), 16000);
  });

  it("off 档位返回 undefined", () => {
    assert.equal(thinkingLevelToModelThinkingParams("off", "openai", "gpt-4o", { enabled: false }), undefined);
  });

  it("medium 档位 OpenAI 解析为 reasoning_effort medium", () => {
    assert.deepEqual(thinkingLevelToModelThinkingParams("medium", "openai", "gpt-4o", { enabled: false }), { protocol: "openai", openai: { reasoning_effort: "medium" } });
  });

  it("Anthropic budget 小于 effective max_tokens", () => {
    const params = thinkingLevelToModelThinkingParams("medium", "anthropic", "claude-3-5-sonnet", { enabled: false });
    const effective = resolveEffectiveMaxTokens({ enabled: false }, "anthropic");
    assert.equal(params?.protocol, "anthropic");
    if (params?.protocol === "anthropic") {
      assert.ok(params.anthropic.budget_tokens < effective);
    }
  });

  it("Gemini 2.5 medium 使用 thinkingBudget -1", () => {
    const params = thinkingLevelToModelThinkingParams("medium", "gemini", "gemini-2.5-flash", { enabled: false });
    if (params?.protocol === "gemini") {
      assert.equal(params.gemini.thinkingConfig.thinkingBudget, -1);
    }
  });

  it("Gemini 3.x medium 使用 thinkingLevel medium", () => {
    const params = thinkingLevelToModelThinkingParams("medium", "gemini", "gemini-3-pro", { enabled: false });
    if (params?.protocol === "gemini") {
      assert.equal(params.gemini.thinkingConfig.thinkingLevel, "medium");
    }
  });
});
