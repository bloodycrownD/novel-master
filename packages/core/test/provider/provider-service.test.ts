import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createProviderServices } from "../../src/service/provider/create-provider-services.js";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";
import { ProviderError } from "../../src/errors/provider-errors.js";
import {
  BUILTIN_PROVIDER_UUID_OPENAI,
  BUILTIN_PROVIDER_UUID_OPENCODE,
} from "../../src/domain/provider/logic/builtin-providers.js";
import { savedModelDisplayName } from "../../src/domain/provider/model/saved-model.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import {
  clearProtocolAdapters,
  getProtocolAdapter,
} from "../../src/infra/llm-protocol/logic/registry.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

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

describe("ProviderService", () => {
  it("lists opencode with apiKey set via builtin default", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const list = await bundle.providers.list();
    const opencode = list.find((p) => p.id === BUILTIN_PROVIDER_UUID_OPENCODE);
    assert.ok(opencode);
    assert.equal(opencode.builtinKey, "opencode");
    assert.equal(opencode.apiKeyStatus, "set");
  });

  it("T-PI3：create 不传 id → UUID；缺/空白 displayName → 错误", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const created = await bundle.providers.create({
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      displayName: "自定义网关",
      apiKey: "k",
    });
    assert.match(created.id, /^[0-9a-f-]{36}$/i);
    assert.equal(created.displayName, "自定义网关");
    assert.equal(created.builtinKey, null);

    await assert.rejects(
      () =>
        bundle.providers.create({
          protocol: "openai",
          baseUrl: "https://example.com/v1",
          displayName: "   ",
        }),
      (e) => e instanceof ProviderError && e.code === "INVALID_ARGUMENT",
    );
  });

  it("T-PI4：edit 清空 displayName → 错误；改名后模型主文案前缀更新", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const provider = await bundle.providers.create({
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      displayName: "旧名称",
      apiKey: "k",
    });
    const saved = await bundle.providerModels.create(provider.id, "m1");
    assert.equal(savedModelDisplayName(saved, provider.displayName), "旧名称/m1");

    await assert.rejects(
      () => bundle.providers.edit(provider.id, { displayName: "  " }),
      (e) => e instanceof ProviderError && e.code === "INVALID_ARGUMENT",
    );

    const renamed = await bundle.providers.edit(provider.id, {
      displayName: "新名称",
    });
    assert.equal(
      savedModelDisplayName(saved, renamed.displayName),
      "新名称/m1",
    );
  });

  it("T-PI5：内置不可删、不可改 protocol", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    await assert.rejects(
      () =>
        bundle.providers.edit(BUILTIN_PROVIDER_UUID_OPENAI, {
          protocol: "gemini",
        }),
      (e) => e instanceof ProviderError && e.code === "BUILTIN_PROVIDER",
    );
    await assert.rejects(
      () => bundle.providers.delete(BUILTIN_PROVIDER_UUID_OPENAI),
      (e) => e instanceof ProviderError && e.code === "BUILTIN_PROVIDER",
    );
  });

  it("model request fails when not saved", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    await assert.rejects(
      () =>
        bundle.modelRequests.request(
          "00000000-0000-4000-8000-000000000000",
          "hi",
        ),
      (e) => e instanceof ProviderError && e.code === "MODEL_NOT_SAVED",
    );
  });

  it("delete custom provider removes secret ref", async () => {
    const ctx = getNovelMasterTestContext();
    const secrets = memorySecretStore();
    const bundle = createProviderServices(ctx.conn, secrets);
    const created = await bundle.providers.create({
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      displayName: "tmpgw",
      apiKey: "gw-secret",
    });
    assert.equal(await secrets.has(`provider/${created.id}/apiKey`), true);
    await bundle.providers.delete(created.id);
    assert.equal(await secrets.has(`provider/${created.id}/apiKey`), false);
  });

  it("delete removes secret at default ref when secretRef is null", async () => {
    const ctx = getNovelMasterTestContext();
    const secrets = memorySecretStore();
    const bundle = createProviderServices(ctx.conn, secrets);
    const displayName = "orphan" + testIsolationSuffix();
    const created = await bundle.providers.create({
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      displayName,
    });
    await secrets.set(`provider/${created.id}/apiKey`, "orphan-secret");
    assert.equal(await secrets.has(`provider/${created.id}/apiKey`), true);
    await bundle.providers.delete(created.id);
    assert.equal(await secrets.has(`provider/${created.id}/apiKey`), false);
  });

  it("edit with empty apiKey clears stored secret", async () => {
    const ctx = getNovelMasterTestContext();
    const secrets = memorySecretStore();
    const bundle = createProviderServices(ctx.conn, secrets);
    const created = await bundle.providers.create({
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      displayName: "clearkey" + testIsolationSuffix(),
      apiKey: "to-clear",
    });
    assert.equal(await secrets.has(`provider/${created.id}/apiKey`), true);
    await bundle.providers.edit(created.id, { apiKey: "" });
    assert.equal(await secrets.has(`provider/${created.id}/apiKey`), false);
    const row = await bundle.providers.get(created.id);
    assert.equal(row.secretRef, null);
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

    const ctx = getNovelMasterTestContext();
    const secrets = memorySecretStore();
    const kkv = createKkvService(ctx.conn);
    const bundle = createProviderServices(ctx.conn, secrets);
    const created = await bundle.providers.create({
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      displayName: "custom",
      apiKey: "sk-test",
    });

    await bundle.providerModels.fetch(created.id);
    const keysBefore = await kkv.listKeys("nm-model-suggestions");
    assert.ok(keysBefore.includes(created.id));

    await bundle.providers.delete(created.id);
    const keysAfter = await kkv.listKeys("nm-model-suggestions");
    assert.ok(!keysAfter.includes(created.id));
    clearProtocolAdapters();
  });
});
