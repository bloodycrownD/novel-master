import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferLlmProtocolFromSavedModelId } from "../../src/domain/provider/logic/infer-llm-protocol-from-model-id.js";
import {
  BUILTIN_KEY_TO_UUID,
  BUILTIN_PROVIDER_UUID_OPENAI,
} from "../../src/domain/provider/logic/builtin-providers.js";
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
  const cases: Array<{ key: string; vendorModelId: string; expected: string }> = [
    { key: "openai", vendorModelId: "gpt-4o", expected: "openai" },
    {
      key: "anthropic",
      vendorModelId: "claude-3-5-sonnet-20241022",
      expected: "anthropic",
    },
    { key: "google", vendorModelId: "gemini-2.0-flash", expected: "gemini" },
    {
      key: "openrouter",
      vendorModelId: "meta-llama/llama-3-70b-instruct",
      expected: "openai",
    },
    { key: "opencode", vendorModelId: "big-pickle", expected: "openai" },
  ];

  for (const { key, vendorModelId, expected } of cases) {
    it(`maps builtin ${key}/${vendorModelId} -> ${expected}`, async () => {
      const ctx = getNovelMasterTestContext();
      const bundle = createProviderServices(ctx.conn, memorySecretStore());
      const providerId = BUILTIN_KEY_TO_UUID[key]!;
      const saved = await bundle.providerModels.create(providerId, vendorModelId);
      assert.equal(
        await inferLlmProtocolFromSavedModelId(saved.id, bundle.savedModelRepo),
        expected,
      );
    });
  }

  it("T-PI5b：providerId 为固定内置 UUID 时仍解析到正确 protocol", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create(
      BUILTIN_PROVIDER_UUID_OPENAI,
      "gpt-4o",
    );
    assert.equal(
      await inferLlmProtocolFromSavedModelId(saved.id, bundle.savedModelRepo),
      "openai",
    );
  });

  it("自定义无 builtin_key 时须传入 providers 才走行上 protocol", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const created = await bundle.providers.create({
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      displayName: "custom-gateway",
      apiKey: "k",
    });
    const saved = await bundle.providerModels.create(created.id, "some-model");
    assert.equal(
      await inferLlmProtocolFromSavedModelId(saved.id, bundle.savedModelRepo),
      "anthropic",
    );
    assert.equal(
      await inferLlmProtocolFromSavedModelId(
        saved.id,
        bundle.savedModelRepo,
        bundle.providerRepo,
      ),
      "openai",
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
