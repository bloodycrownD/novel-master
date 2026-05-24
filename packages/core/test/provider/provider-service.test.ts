import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createProviderServices } from "../../src/service/provider/create-provider-services.js";
import { ProviderError } from "../../src/errors/provider-errors.js";
import type { SecretStore } from "@novel-master/sksp";
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
});
