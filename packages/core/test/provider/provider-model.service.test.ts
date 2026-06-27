import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { formatApplicationModelId } from "../../src/domain/provider/logic/application-model-id.js";
import { createProviderServices } from "../../src/service/provider/create-provider-services.js";
import { ProviderError } from "../../src/errors/provider-errors.js";
import {
  savedModelContextWindowTokens,
  savedModelTokenCounterMode,
} from "../../src/domain/provider/model/saved-model-settings.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import {
  clearProtocolAdapters,
  getProtocolAdapter,
} from "../../src/infra/llm-protocol/logic/registry.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";
function memorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    async get(ref) {
      return map.get(ref) ?? null;
    },
    async has(ref) {
      return map.has(ref);
    },
    async set(ref, plain) {
      map.set(ref, plain);
    },
    async delete(ref) {
      return map.delete(ref);
    },
  };
}


novelMasterTestFixture();

describe("ProviderModelService fetch", () => {
  it("populates suggestions from listModels response", async () => {
    clearProtocolAdapters();
    const fetchFn = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    getProtocolAdapter("openai", fetchFn as typeof fetch);

    const ctx = getNovelMasterTestContext();
    const secrets = memorySecretStore();
    const bundle = createProviderServices(ctx.conn, secrets);
    await secrets.set("provider/openai/apiKey", "sk-test");

    await bundle.providerModels.fetch("openai");
    const suggestions = await bundle.providerModels.suggestList("openai");
    assert.equal(suggestions.length, 2);
    assert.ok(
      suggestions.some((s) => s.vendorModelId === "gpt-4o" && s.stale === false),
    );
    const saved = await bundle.providerModels.savedList("openai");
    assert.equal(saved.length, 0);
    clearProtocolAdapters();
  });

  it("normalizes prefixed vendor ids when saving fetched models", async () => {
    clearProtocolAdapters();
    const fetchFn = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [{ id: "zhipu/glm-4-flash" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    getProtocolAdapter("openai", fetchFn as typeof fetch);

    const ctx = getNovelMasterTestContext();
    const secrets = memorySecretStore();
    const bundle = createProviderServices(ctx.conn, secrets);
    await bundle.providers.create({
      id: "zhipu",
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
    });

    await bundle.providerModels.fetch("zhipu");
    await bundle.providerModels.save("zhipu", "zhipu/glm-4-flash");
    const saved = await bundle.providerModels.savedList("zhipu");
    assert.equal(saved.length, 1);
    assert.equal(saved[0]!.vendorModelId, "glm-4-flash");
    assert.equal(
      formatApplicationModelId(saved[0]!.providerId, saved[0]!.vendorModelId),
      "zhipu/glm-4-flash",
    );
    clearProtocolAdapters();
  });
});

describe("ProviderModelService settings", () => {
  it("save claude-3-5 gets contextWindowTokens 200_000", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create(
      "openai",
      "claude-3-5-sonnet",
    );
    assert.equal(savedModelContextWindowTokens(saved.settings), 200_000);
  });

  it("save unknown model gets contextWindowTokens 128_000", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create("openai", "unknown-model");
    assert.equal(savedModelContextWindowTokens(saved.settings), 128_000);
  });

  it("updateSettings rejects non-positive contextWindowTokens", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    await bundle.providerModels.create("openai", "manual-model");
    await assert.rejects(
      () =>
        bundle.providerModels.updateSettings("openai", "manual-model", {
          contextWindowTokens: 0,
        }),
      (e) => e instanceof ProviderError && e.code === "INVALID_ARGUMENT",
    );
  });

  it("new saved model defaults tokenCounterMode to auto", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create("openai", "gpt-4o");
    assert.equal(savedModelTokenCounterMode(saved.settings), "auto");
  });

  it("updateSettings persists tokenCounterMode round-trip", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    await bundle.providerModels.create("openai", "gpt-4o");
    const updated = await bundle.providerModels.updateSettings(
      "openai",
      "gpt-4o",
      { tokenCounterMode: "gemma" },
    );
    assert.equal(savedModelTokenCounterMode(updated.settings), "gemma");
    const appId = formatApplicationModelId("openai", "gpt-4o");
    assert.equal(
      await bundle.providerModels.getTokenCounterMode(appId),
      "gemma",
    );
  });

  it("getTokenCounterMode returns auto for unsaved model", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    assert.equal(
      await bundle.providerModels.getTokenCounterMode("openai/unknown"),
      "auto",
    );
  });

  it("updateSettings rejects invalid tokenCounterMode", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    await bundle.providerModels.create("openai", "gpt-4o");
    await assert.rejects(
      () =>
        bundle.providerModels.updateSettings("openai", "gpt-4o", {
          tokenCounterMode: "not-a-mode" as "auto",
        }),
      (e) => e instanceof ProviderError && e.code === "INVALID_ARGUMENT",
    );
  });

  it("updateSettings 持久化 thinkingLevel 为 v2 JSON", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    await bundle.providerModels.create("openai", "gpt-4o");
    const updated = await bundle.providerModels.updateSettings("openai", "gpt-4o", {
      thinkingLevel: "high",
    });
    assert.equal(updated.settings.generation.thinkingLevel, "high");
    assert.equal(updated.settings.schemaVersion, 2);
    const refetched = await bundle.providerModels.getSaved("openai/gpt-4o");
    assert.ok(refetched != null);
    assert.equal(refetched.settings.generation.thinkingLevel, "high");
    assert.equal(refetched.settings.schemaVersion, 2);
  });
});

describe("ProviderModelService editSaved", () => {
  it("preserves displayName when omitted", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    await bundle.providerModels.create("openai", "manual-model");
    await bundle.providerModels.editSaved("openai", "manual-model", "Label A");
    const after = await bundle.providerModels.editSaved(
      "openai",
      "manual-model",
    );
    assert.equal(after.displayName, "Label A");
  });
});
