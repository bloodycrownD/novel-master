import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDefaultTokenCounterRegistry,
  HeuristicTokenCounter,
  resolveTokenizerFamily,
} from "../../../src/infra/tokenizer/index.js";
import { TiktokenTokenCounter } from "../../../src/infra/tokenizer/impl/tiktoken-token-counter.js";
import { ClaudeWebTokenCounter } from "../../../src/infra/tokenizer/impl/web-tokenizer-counter.js";
import { emptyRegistryDeps } from "./registry-test-helpers.js";

describe("TokenCounterRegistry", () => {
  it("R1: unknown provider id still routes gpt-4o by model name", async () => {
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const counter = await registry.forApplicationModel("missing/gpt-4o");
    assert.ok(counter instanceof TiktokenTokenCounter);
  });

  it("R2: gpt-4o → tiktoken regardless of protocol", () => {
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const counter = registry.forVendorModel("gpt-4o", "gemini");
    assert.ok(counter instanceof TiktokenTokenCounter);
  });

  it("R2b: forApplicationModel openai/gpt-4o → tiktoken", async () => {
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const counter = await registry.forApplicationModel("openai/gpt-4o");
    assert.ok(counter instanceof TiktokenTokenCounter);
  });

  it("R3: openai protocol + claude model → claude counter", async () => {
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const counter = await registry.forApplicationModel(
      "openai/claude-3-5-sonnet-20241022",
    );
    assert.ok(counter instanceof ClaudeWebTokenCounter);
  });

  it("gemini protocol + gemini model → gemma sentencepiece counter kind", async () => {
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const counter = await registry.forApplicationModel("gemini/gemini-2.0-flash");
    assert.equal(counter.kind, "gemma");
  });

  it("unsaved model still routes by vendor model id", async () => {
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const counter = await registry.forApplicationModel("openai/gpt-4o");
    assert.ok(counter instanceof TiktokenTokenCounter);
  });

  it("heuristic override forces heuristic for gpt-4o", () => {
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const counter = registry.forVendorModel("gpt-4o", { override: "heuristic" });
    assert.ok(counter instanceof HeuristicTokenCounter);
  });
});

describe("resolveTokenizerFamily", () => {
  const cases: Array<[string, string]> = [
    ["openai/claude-3-5-sonnet", "claude"],
    ["gemini-2.0-flash", "gemma"],
    ["gpt-4o-mini", "tiktoken"],
    ["my-custom/foo", "heuristic"],
    ["anthropic/claude-3-opus", "claude"],
    ["meta-llama/Llama-3-70b", "llama3"],
    ["mistral-large", "mistral"],
    ["qwen2.5-72b", "qwen2"],
    ["command-r-plus", "command-r"],
    ["deepseek-chat", "deepseek"],
  ];

  for (const [model, expected] of cases) {
    it(`F1: ${model} → ${expected}`, () => {
      assert.equal(resolveTokenizerFamily(model), expected);
    });
  }
});
