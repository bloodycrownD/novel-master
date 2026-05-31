import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseAnthropicUsage,
  parseGeminiUsage,
  parseOpenAiUsage,
} from "../../../src/infra/llm-protocol/logic/usage-parser.js";

describe("usage-parser", () => {
  it("U1: parseOpenAiUsage standard JSON", () => {
    const usage = parseOpenAiUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    assert.deepEqual(usage, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("U2: parseAnthropicUsage", () => {
    const usage = parseAnthropicUsage({
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    assert.equal(usage?.promptTokens, 100);
    assert.equal(usage?.completionTokens, 20);
    assert.equal(usage?.totalTokens, 120);
  });

  it("U3: parseGeminiUsage minimal fixture", () => {
    const usage = parseGeminiUsage({
      usageMetadata: {
        promptTokenCount: 8,
        candidatesTokenCount: 4,
        totalTokenCount: 12,
      },
    });
    assert.deepEqual(usage, {
      promptTokens: 8,
      completionTokens: 4,
      totalTokens: 12,
    });
  });
});
