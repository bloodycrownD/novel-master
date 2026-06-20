import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferLlmProtocolFromApplicationModelId } from "../../src/domain/provider/logic/infer-llm-protocol-from-model-id.js";

describe("inferLlmProtocolFromApplicationModelId", () => {
  const cases: Array<{ applicationModelId: string; expected: string }> = [
    { applicationModelId: "openai/gpt-4o", expected: "openai" },
    {
      applicationModelId: "anthropic/claude-3-5-sonnet-20241022",
      expected: "anthropic",
    },
    { applicationModelId: "google/gemini-2.0-flash", expected: "gemini" },
    {
      applicationModelId: "openrouter/meta-llama/llama-3-70b-instruct",
      expected: "openai",
    },
    { applicationModelId: "custom-gateway/some-model", expected: "anthropic" },
    { applicationModelId: "not-a-valid-id", expected: "anthropic" },
  ];

  for (const { applicationModelId, expected } of cases) {
    it(`maps ${applicationModelId} -> ${expected}`, () => {
      assert.equal(
        inferLlmProtocolFromApplicationModelId(applicationModelId),
        expected,
      );
    });
  }
});
