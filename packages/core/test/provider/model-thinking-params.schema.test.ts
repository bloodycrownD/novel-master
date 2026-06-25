import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { modelThinkingParamsSchema } from "../../src/domain/provider/model/model-thinking-params.schema.js";

describe("modelThinkingParams schema", () => {
  it("解析 Anthropic thinking 参数", () => {
    const parsed = modelThinkingParamsSchema.parse({
      protocol: "anthropic",
      anthropic: { type: "enabled", budget_tokens: 4095 },
    });
    assert.equal(parsed.protocol, "anthropic");
    if (parsed.protocol === "anthropic") {
      assert.equal(parsed.anthropic.budget_tokens, 4095);
    }
  });

  it("解析 OpenAI reasoning_effort", () => {
    const parsed = modelThinkingParamsSchema.parse({
      protocol: "openai",
      openai: { reasoning_effort: "medium" },
    });
    assert.equal(parsed.protocol, "openai");
  });

  it("解析 Gemini thinkingConfig", () => {
    const parsed = modelThinkingParamsSchema.parse({
      protocol: "gemini",
      gemini: { thinkingConfig: { thinkingBudget: -1 } },
    });
    assert.equal(parsed.protocol, "gemini");
  });
});
