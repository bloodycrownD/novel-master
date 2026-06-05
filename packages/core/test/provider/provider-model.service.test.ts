import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createProviderServices } from "../../src/service/provider/create-provider-services.js";
import { ProviderError } from "../../src/errors/provider-errors.js";
import { formatApplicationModelId } from "../../src/domain/provider/logic/application-model-id.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import {
  clearProtocolAdapters,
  getProtocolAdapter,
} from "../../src/infra/llm-protocol/logic/registry.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

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

    const ctx = await openNovelMasterTestConnection();
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

    await ctx.conn.close();
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

    const ctx = await openNovelMasterTestConnection();
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

    await ctx.conn.close();
    clearProtocolAdapters();
  });
});

describe("ProviderModelService settings", () => {
  it("save claude-3-5 gets contextWindowTokens 200_000", async () => {
    const ctx = await openNovelMasterTestConnection();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create(
      "openai",
      "claude-3-5-sonnet",
    );
    assert.equal(saved.settings.contextWindowTokens, 200_000);
    await ctx.conn.close();
  });

  it("save unknown model gets contextWindowTokens 128_000", async () => {
    const ctx = await openNovelMasterTestConnection();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create("openai", "unknown-model");
    assert.equal(saved.settings.contextWindowTokens, 128_000);
    await ctx.conn.close();
  });

  it("updateSettings rejects non-positive contextWindowTokens", async () => {
    const ctx = await openNovelMasterTestConnection();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    await bundle.providerModels.create("openai", "manual-model");
    await assert.rejects(
      () =>
        bundle.providerModels.updateSettings("openai", "manual-model", {
          contextWindowTokens: 0,
        }),
      (e) => e instanceof ProviderError && e.code === "INVALID_ARGUMENT",
    );
    await ctx.conn.close();
  });
});

describe("ProviderModelService editSaved", () => {
  it("preserves displayName when omitted", async () => {
    const ctx = await openNovelMasterTestConnection();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    await bundle.providerModels.create("openai", "manual-model");
    await bundle.providerModels.editSaved("openai", "manual-model", "Label A");
    const after = await bundle.providerModels.editSaved(
      "openai",
      "manual-model",
    );
    assert.equal(after.displayName, "Label A");
    await ctx.conn.close();
  });
});
