import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createProviderServices } from "../../src/service/provider/create-provider-services.js";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";
import { ProviderError } from "../../src/errors/provider-errors.js";
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

describe("ProviderService", () => {
  it("rejects create with built-in id", async () => {
    const ctx = await openNovelMasterTestConnection();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    await assert.rejects(
      () =>
        bundle.providers.create({
          id: "openai",
          protocol: "openai",
          baseUrl: "https://example.com/v1",
        }),
      (e) => e instanceof ProviderError && e.code === "BUILTIN_PROVIDER",
    );
    await ctx.conn.close();
  });

  it("rejects edit protocol on built-in", async () => {
    const ctx = await openNovelMasterTestConnection();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    await assert.rejects(
      () => bundle.providers.edit("openai", { protocol: "gemini" }),
      (e) => e instanceof ProviderError && e.code === "BUILTIN_PROVIDER",
    );
    await ctx.conn.close();
  });

  it("model request fails when not saved", async () => {
    const ctx = await openNovelMasterTestConnection();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    await assert.rejects(
      () => bundle.modelRequests.request("openai/gpt-4o", "hi"),
      (e) => e instanceof ProviderError && e.code === "MODEL_NOT_SAVED",
    );
    await ctx.conn.close();
  });

  it("delete custom provider removes secret ref", async () => {
    const ctx = await openNovelMasterTestConnection();
    const secrets = memorySecretStore();
    const bundle = createProviderServices(ctx.conn, secrets);
    await bundle.providers.create({
      id: "tmpgw",
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      apiKey: "gw-secret",
    });
    assert.equal(await secrets.has("provider/tmpgw/apiKey"), true);
    await bundle.providers.delete("tmpgw");
    assert.equal(await secrets.has("provider/tmpgw/apiKey"), false);
    await ctx.conn.close();
  });

  it("delete provider clears nm-model-suggestions KKV after fetch", async () => {
    clearProtocolAdapters();
    const fetchFn = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [{ id: "gpt-4o" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    getProtocolAdapter("openai", fetchFn as typeof fetch);

    const ctx = await openNovelMasterTestConnection();
    const secrets = memorySecretStore();
    const kkv = createKkvService(ctx.conn);
    const bundle = createProviderServices(ctx.conn, secrets);
    await secrets.set("provider/custom/apiKey", "sk-test");
    await bundle.providers.create({
      id: "custom",
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
    });

    await bundle.providerModels.fetch("custom");
    const keysBefore = await kkv.listKeys("nm-model-suggestions");
    assert.ok(keysBefore.includes("custom"));

    await bundle.providers.delete("custom");
    const keysAfter = await kkv.listKeys("nm-model-suggestions");
    assert.ok(!keysAfter.includes("custom"));

    await ctx.conn.close();
    clearProtocolAdapters();
  });
});
