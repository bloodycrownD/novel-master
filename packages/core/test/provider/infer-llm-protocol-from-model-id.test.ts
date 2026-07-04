import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferLlmProtocolFromSavedModelId } from "../../src/domain/provider/logic/infer-llm-protocol-from-model-id.js";
import { createProviderServices } from "../../src/service/provider/create-provider-services.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import { getNovelMasterTestContext, novelMasterTestFixture } from "../helpers/novel-master-fixture.js";

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

describe("inferLlmProtocolFromSavedModelId", () => {
  const cases: Array<{ providerId: string; vendorModelId: string; expected: string }> = [
    { providerId: "openai", vendorModelId: "gpt-4o", expected: "openai" },
    {
      providerId: "anthropic",
      vendorModelId: "claude-3-5-sonnet-20241022",
      expected: "anthropic",
    },
    { providerId: "google", vendorModelId: "gemini-2.0-flash", expected: "gemini" },
    {
      providerId: "openrouter",
      vendorModelId: "meta-llama/llama-3-70b-instruct",
      expected: "openai",
    },
    { providerId: "opencode", vendorModelId: "big-pickle", expected: "openai" },
  ];

  for (const { providerId, vendorModelId, expected } of cases) {
    it(`maps ${providerId}/${vendorModelId} -> ${expected}`, async () => {
      const ctx = getNovelMasterTestContext();
      const bundle = createProviderServices(ctx.conn, memorySecretStore());
      const saved = await bundle.providerModels.create(providerId, vendorModelId);
      assert.equal(
        await inferLlmProtocolFromSavedModelId(saved.id, bundle.savedModelRepo),
        expected,
      );
    });
  }

  it("unknown provider id falls back to anthropic", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    await bundle.providers.create({
      id: "custom-gateway",
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      apiKey: "k",
    });
    const saved = await bundle.providerModels.create("custom-gateway", "some-model");
    assert.equal(
      await inferLlmProtocolFromSavedModelId(saved.id, bundle.savedModelRepo),
      "anthropic",
    );
  });

  it("missing saved model id falls back to anthropic", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    assert.equal(
      await inferLlmProtocolFromSavedModelId(
        "00000000-0000-4000-8000-000000000000",
        bundle.savedModelRepo,
      ),
      "anthropic",
    );
  });
});
