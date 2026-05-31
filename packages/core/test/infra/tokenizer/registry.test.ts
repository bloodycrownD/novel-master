import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDefaultTokenCounterRegistry,
  HeuristicTokenCounter,
} from "../../../src/infra/tokenizer/index.js";
import { TiktokenTokenCounter } from "../../../src/infra/tokenizer/impl/tiktoken-token-counter.js";
import {
  mockProviderRepository,
  mockSavedModelRepository,
  mutableProviderRepository,
  emptyRegistryDeps,
} from "./registry-test-helpers.js";

describe("TokenCounterRegistry", () => {
  it("R1: unknown provider → heuristic", async () => {
    const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const counter = await registry.forApplicationModel("missing/gpt-4o");
    assert.ok(counter instanceof HeuristicTokenCounter);
  });

  it("R2: openai protocol gpt-4o → tiktoken", () => {
    const registry = createDefaultTokenCounterRegistry({
      providers: mockProviderRepository({ openai: "openai" }),
    });
    const counter = registry.forVendorModel("gpt-4o", "openai");
    assert.ok(counter instanceof TiktokenTokenCounter);
  });

  it("R2b: forApplicationModel openai/gpt-4o with openai protocol → tiktoken", async () => {
    const registry = createDefaultTokenCounterRegistry({
      providers: mockProviderRepository({ openai: "openai" }),
    });
    const counter = await registry.forApplicationModel("openai/gpt-4o");
    assert.ok(counter instanceof TiktokenTokenCounter);
  });

  it("R3: provider protocol change visible on next forApplicationModel (no restart)", async () => {
    const { repo, setProtocol } = mutableProviderRepository("openai", "openai");
    const registry = createDefaultTokenCounterRegistry({ providers: repo });

    assert.ok(
      (await registry.forApplicationModel("openai/gpt-4o")) instanceof
        TiktokenTokenCounter,
    );

    setProtocol("gemini");
    assert.ok(
      (await registry.forApplicationModel("openai/gpt-4o")) instanceof
        HeuristicTokenCounter,
    );
  });

  it("gemini protocol → heuristic even for gemini model name", async () => {
    const registry = createDefaultTokenCounterRegistry({
      providers: mockProviderRepository({ gemini: "gemini" }),
    });
    const counter = await registry.forApplicationModel("gemini/gemini-2.0-flash");
    assert.ok(counter instanceof HeuristicTokenCounter);
  });

  it("unsaved model → heuristic when savedModels repo provided", async () => {
    const registry = createDefaultTokenCounterRegistry({
      providers: mockProviderRepository({ openai: "openai" }),
      savedModels: mockSavedModelRepository(new Set()),
    });
    const counter = await registry.forApplicationModel("openai/gpt-4o");
    assert.ok(counter instanceof HeuristicTokenCounter);
  });
});
