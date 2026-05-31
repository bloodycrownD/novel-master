import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDefaultTokenCounterRegistry,
  HeuristicTokenCounter,
} from "../../../src/infra/tokenizer/index.js";
import { TiktokenTokenCounter } from "../../../src/infra/tokenizer/impl/tiktoken-token-counter.js";

describe("TokenCounterRegistry", () => {
  it("R1: unknown provider → heuristic", () => {
    const registry = createDefaultTokenCounterRegistry({
      resolveProviderProtocol: () => undefined,
    });
    const counter = registry.forApplicationModel("missing/gpt-4o");
    assert.ok(counter instanceof HeuristicTokenCounter);
  });

  it("R2: openai protocol gpt-4o → tiktoken", () => {
    const registry = createDefaultTokenCounterRegistry({
      resolveProviderProtocol: (id) => (id === "openai" ? "openai" : undefined),
    });
    const counter = registry.forVendorModel("gpt-4o", "openai");
    assert.ok(counter instanceof TiktokenTokenCounter);
  });

  it("gemini protocol → heuristic even for gemini model name", () => {
    const registry = createDefaultTokenCounterRegistry({
      resolveProviderProtocol: (id) => (id === "gemini" ? "gemini" : undefined),
    });
    const counter = registry.forApplicationModel("gemini/gemini-2.0-flash");
    assert.ok(counter instanceof HeuristicTokenCounter);
  });

  it("unsaved model → heuristic when isSavedModel provided", () => {
    const registry = createDefaultTokenCounterRegistry({
      resolveProviderProtocol: () => "openai",
      isSavedModel: () => false,
    });
    const counter = registry.forApplicationModel("openai/gpt-4o");
    assert.ok(counter instanceof HeuristicTokenCounter);
  });
});
