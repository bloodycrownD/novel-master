import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { thinkingLevelToModelThinkingParams } from "../../src/domain/provider/logic/thinking-level-presets.js";

const samplingOff = { enabled: false as const };

describe("thinkingLevelToModelThinkingParams", () => {
  it("off 返回 undefined", () => {
    assert.equal(
      thinkingLevelToModelThinkingParams("off", "openai", "gpt-4o", samplingOff),
      undefined,
    );
  });

  it("OpenAI 四档映射 reasoning_effort", () => {
    assert.deepEqual(
      thinkingLevelToModelThinkingParams("low", "openai", "gpt-4o", samplingOff),
      { protocol: "openai", openai: { reasoning_effort: "low" } },
    );
    assert.deepEqual(
      thinkingLevelToModelThinkingParams("medium", "openai", "gpt-4o", samplingOff),
      { protocol: "openai", openai: { reasoning_effort: "medium" } },
    );
    assert.deepEqual(
      thinkingLevelToModelThinkingParams("high", "openai", "gpt-4o", samplingOff),
      { protocol: "openai", openai: { reasoning_effort: "high" } },
    );
  });

  it("Anthropic 档位 budget 受 effective max_tokens 钳制", () => {
    const params = thinkingLevelToModelThinkingParams(
      "high",
      "anthropic",
      "claude-3-5-sonnet",
      samplingOff,
    );
    assert.equal(params?.protocol, "anthropic");
    if (params?.protocol === "anthropic") {
      assert.equal(params.anthropic.budget_tokens, 4095);
    }
  });

  it("Gemini 2.5 使用 thinkingBudget preset", () => {
    const low = thinkingLevelToModelThinkingParams(
      "low",
      "gemini",
      "gemini-2.5-flash",
      samplingOff,
    );
    assert.equal(low?.protocol, "gemini");
    if (low?.protocol === "gemini") {
      assert.equal(low.gemini.thinkingConfig.thinkingBudget, 4096);
    }
    const medium = thinkingLevelToModelThinkingParams(
      "medium",
      "gemini",
      "gemini-2.5-flash",
      samplingOff,
    );
    if (medium?.protocol === "gemini") {
      assert.equal(medium.gemini.thinkingConfig.thinkingBudget, -1);
    }
    const high = thinkingLevelToModelThinkingParams(
      "high",
      "gemini",
      "gemini-2.5-flash",
      samplingOff,
    );
    if (high?.protocol === "gemini") {
      assert.equal(high.gemini.thinkingConfig.thinkingBudget, 16384);
    }
  });

  it("Gemini 3.x 使用 thinkingLevel preset", () => {
    const params = thinkingLevelToModelThinkingParams(
      "medium",
      "gemini",
      "gemini-3-pro",
      samplingOff,
    );
    if (params?.protocol === "gemini") {
      assert.equal(params.gemini.thinkingConfig.thinkingLevel, "medium");
    }
  });
});
