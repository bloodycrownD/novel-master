import {  BUILTIN_PROVIDER_UUID_OPENAI  } from "../../src/domain/provider/logic/builtin-providers.js";
import assert from "node:assert/strict";
import {  describe, it, mock  } from "node:test";
import {  ProviderServiceFactory  } from "../../src/service/provider/provider-service-factory.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import {  Registry  } from "../../src/infra/llm-protocol/logic/registry.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../helpers/novel-master-fixture.js";
import {  unwrap  } from "../helpers/result-unwrap.js";

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

describe("ModelRequestService saved model sampling", () => {
  it("merges enabled settings.sampling when options.sampling omitted", async () => {
    Registry.clearProtocolAdapters();
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
    Registry.getProtocolAdapter("openai", fetchFn as typeof fetch);

    const ctx = getNovelMasterTestContext();
    try {
      const secrets = memorySecretStore();
      const bundle = ProviderServiceFactory.create(ctx.conn, secrets);
      await secrets.set(`provider/${BUILTIN_PROVIDER_UUID_OPENAI}/apiKey`, "sk-test");
      const saved = unwrap(await bundle.providerModels.create(BUILTIN_PROVIDER_UUID_OPENAI, "profile-merge"));
      await bundle.providerModels.updateSettings(saved.id, {
        sampling: {
          enabled: true,
          params: { protocol: "openai", openai: { temperature: 0.25 } },
        },
      });

      await bundle.modelRequests.request(saved.id, "hi", {
        system: "test",
      });
      assert.equal(capturedBody?.temperature, 0.25);
    } finally {
      Registry.clearProtocolAdapters();
    }
  });

  it("disabled or absent sampling does not set sampling", async () => {
    Registry.clearProtocolAdapters();
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
    Registry.getProtocolAdapter("openai", fetchFn as typeof fetch);

    const ctx = getNovelMasterTestContext();
    try {
      const secrets = memorySecretStore();
      const bundle = ProviderServiceFactory.create(ctx.conn, secrets);
      await secrets.set(`provider/${BUILTIN_PROVIDER_UUID_OPENAI}/apiKey`, "sk-test");
      const saved = unwrap(await bundle.providerModels.create(BUILTIN_PROVIDER_UUID_OPENAI, "no-profile"));
      await bundle.modelRequests.request(saved.id, "hi", {
        system: "test",
      });
      assert.equal(capturedBody?.temperature, undefined);
    } finally {
      Registry.clearProtocolAdapters();
    }
  });

  it("consumes persisted retry policy in wired modelRequests path", async () => {
    Registry.clearProtocolAdapters();
    let callCount = 0;
    const fetchFn = mock.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ error: { message: "upstream failed" } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    Registry.getProtocolAdapter("openai", fetchFn as typeof fetch);

    const ctx = getNovelMasterTestContext();
    try {
      const secrets = memorySecretStore();
      const bundle = ProviderServiceFactory.create(ctx.conn, secrets);
      const retryPolicies = ProviderServiceFactory.createRetryPolicy(ctx.conn);
      await retryPolicies.setPolicy({
        maxRetries: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterRatio: 0,
      });
      await secrets.set(`provider/${BUILTIN_PROVIDER_UUID_OPENAI}/apiKey`, "sk-test");
      const saved = unwrap(await bundle.providerModels.create(BUILTIN_PROVIDER_UUID_OPENAI, "retry-policy"));

      const out = unwrap(await bundle.modelRequests.request(saved.id, "hi", {
        system: "test",
      }));
      assert.equal(out.assistantText, "ok");
      assert.equal(callCount, 2);
    } finally {
      Registry.clearProtocolAdapters();
    }
  });
});
