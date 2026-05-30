import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { createProviderServices } from "../../src/service/provider/create-provider-services.js";
import type { SecretStore } from "@/infra/sksp/secret-store.port.js";
import {
  clearProtocolAdapters,
  getProtocolAdapter,
} from "../../src/infra/llm-protocol/registry.js";
import { modelSamplingProfileFromJson } from "@novel-master/core";
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

describe("ModelRequestService sampling profile merge", () => {
  it("P2: merges enabled profile when options.sampling omitted", async () => {
    clearProtocolAdapters();
    let capturedBody: Record<string, unknown> | undefined;
    const fetchFn = mock.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    getProtocolAdapter("openai", fetchFn as typeof fetch);

    const ctx = await openNovelMasterTestConnection();
    try {
      const secrets = memorySecretStore();
      const bundle = createProviderServices(ctx.conn, secrets);
      await secrets.set("provider/openai/apiKey", "sk-test");
      await bundle.providerModels.create("openai", "profile-merge");
      await bundle.modelSamplingProfiles.setProfile(
        "openai/profile-merge",
        modelSamplingProfileFromJson({
          schemaVersion: 1,
          enabled: true,
          params: { protocol: "openai", openai: { temperature: 0.25 } },
        }),
      );

      await bundle.modelRequests.request("openai/profile-merge", "hi", {
        system: "test",
      });
      assert.equal(capturedBody?.temperature, 0.25);
    } finally {
      await ctx.conn.close();
      clearProtocolAdapters();
    }
  });

  it("P3: disabled or absent profile does not set sampling", async () => {
    clearProtocolAdapters();
    let capturedBody: Record<string, unknown> | undefined;
    const fetchFn = mock.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    getProtocolAdapter("openai", fetchFn as typeof fetch);

    const ctx = await openNovelMasterTestConnection();
    try {
      const secrets = memorySecretStore();
      const bundle = createProviderServices(ctx.conn, secrets);
      await secrets.set("provider/openai/apiKey", "sk-test");
      await bundle.providerModels.create("openai", "no-profile");
      await bundle.modelRequests.request("openai/no-profile", "hi", {
        system: "test",
      });
      assert.equal(capturedBody?.temperature, undefined);
    } finally {
      await ctx.conn.close();
      clearProtocolAdapters();
    }
  });
});
