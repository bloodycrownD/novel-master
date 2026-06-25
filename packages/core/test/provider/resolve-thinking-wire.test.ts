import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEffectiveMaxTokens,
  resolveThinkingParamsForProtocol,
  resolveThinkingWireDefaults,
} from "../../src/domain/provider/logic/resolve-thinking-wire.js";

describe("resolve-thinking-wire", () => {
  it("Anthropic budget 小于 effective max_tokens", () => {
    const params = resolveThinkingWireDefaults("anthropic", "claude-3-5-sonnet", {
      enabled: false,
    });
    assert.equal(params.protocol, "anthropic");
    if (params.protocol === "anthropic") {
      assert.equal(params.anthropic.budget_tokens, 4095);
    }
    const effective = resolveEffectiveMaxTokens({ enabled: false }, "anthropic");
    assert.equal(effective, 4096);
    assert.ok(
      params.protocol === "anthropic" &&
        params.anthropic.budget_tokens < effective,
    );
  });

  it("OpenAI 默认 reasoning_effort 为 medium", () => {
    const params = resolveThinkingWireDefaults("openai", "gpt-4o", {
      enabled: false,
    });
    assert.deepEqual(params, {
      protocol: "openai",
      openai: { reasoning_effort: "medium" },
    });
  });

  it("Gemini 2.5 使用 thinkingBudget -1", () => {
    const params = resolveThinkingWireDefaults("gemini", "gemini-2.5-flash", {
      enabled: false,
    });
    assert.equal(params.protocol, "gemini");
    if (params.protocol === "gemini") {
      assert.equal(params.gemini.thinkingConfig.thinkingBudget, -1);
    }
  });

  it("Gemini 3.x 使用 thinkingLevel medium", () => {
    const params = resolveThinkingWireDefaults("gemini", "gemini-3-pro", {
      enabled: false,
    });
    if (params.protocol === "gemini") {
      assert.equal(params.gemini.thinkingConfig.thinkingLevel, "medium");
    }
  });

  it("thinking 关闭时返回 undefined", () => {
    assert.equal(
      resolveThinkingParamsForProtocol(
        "openai",
        { enabled: false },
        { enabled: false },
        "gpt-4o",
      ),
      undefined,
    );
  });

  it("thinking 开启时使用已保存 params", () => {
    const params = resolveThinkingParamsForProtocol(
      "openai",
      {
        enabled: true,
        params: { protocol: "openai", openai: { reasoning_effort: "high" } },
      },
      { enabled: false },
      "gpt-4o",
    );
    assert.deepEqual(params, {
      protocol: "openai",
      openai: { reasoning_effort: "high" },
    });
  });
});
