import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { decode } from "@novel-master/core";
import { agentDefinitionSchema, createAgentRegistryService } from "@novel-master/core/agent";
import { formatSavedModelDisplayName } from "../../src/domain/provider/logic/format-saved-model-display-name.js";
import { savedModelDisplayName } from "../../src/domain/provider/model/saved-model.js";
import { createProviderServices } from "../../src/service/provider/create-provider-services.js";
import { ProviderError } from "../../src/errors/provider-errors.js";
import {
  savedModelContextWindowTokens,
  savedModelThinkingLevel,
  savedModelTokenCounterMode,
} from "../../src/domain/provider/model/saved-model-settings.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import {
  clearProtocolAdapters,
  getProtocolAdapter,
} from "../../src/infra/llm-protocol/logic/registry.js";
import { getNovelMasterTestContext, novelMasterTestFixture } from "../helpers/novel-master-fixture.js";
import { createPersistentState } from "../../src/service/persistent-state/create-persistent-state.js";

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
    const saved = await bundle.providerModels.save("zhipu", "zhipu/glm-4-flash");
    const list = await bundle.providerModels.savedList("zhipu");
    assert.equal(list.length, 1);
    assert.equal(saved.vendorModelId, "glm-4-flash");
    assert.equal(saved.modelName, "glm-4-flash");
    assert.equal(
      savedModelDisplayName(saved),
      formatSavedModelDisplayName("zhipu", "glm-4-flash"),
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
    const saved = await bundle.providerModels.create("openai", "manual-model");
    await assert.rejects(
      () =>
        bundle.providerModels.updateSettings(saved.id, {
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

  it("new saved model defaults thinkingLevel to high", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create("openai", "gpt-4o");
    assert.equal(savedModelThinkingLevel(saved.settings), "high");
  });

  it("updateSettings persists tokenCounterMode round-trip", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create("openai", "gpt-4o");
    const updated = await bundle.providerModels.updateSettings(saved.id, {
      tokenCounterMode: "gemma",
    });
    assert.equal(savedModelTokenCounterMode(updated.settings), "gemma");
    assert.equal(
      await bundle.providerModels.getTokenCounterMode(saved.id),
      "gemma",
    );
  });

  it("getTokenCounterMode returns auto for unknown saved model id", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    assert.equal(
      await bundle.providerModels.getTokenCounterMode(
        "00000000-0000-4000-8000-000000000000",
      ),
      "auto",
    );
  });

  it("updateSettings rejects invalid tokenCounterMode", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create("openai", "gpt-4o");
    await assert.rejects(
      () =>
        bundle.providerModels.updateSettings(saved.id, {
          tokenCounterMode: "not-a-mode" as "auto",
        }),
      (e) => e instanceof ProviderError && e.code === "INVALID_ARGUMENT",
    );
  });

  it("updateSettings 持久化 thinkingLevel 为 v2 JSON", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create("openai", "gpt-4o");
    const updated = await bundle.providerModels.updateSettings(saved.id, {
      thinkingLevel: "high",
    });
    assert.equal(updated.settings.generation.thinkingLevel, "high");
    assert.equal(updated.settings.schemaVersion, 2);
    const refetched = await bundle.providerModels.getSavedById(saved.id);
    assert.ok(refetched != null);
    assert.equal(refetched.settings.generation.thinkingLevel, "high");
    assert.equal(refetched.settings.schemaVersion, 2);
  });
});

describe("ProviderModelService multi-preset（T-SM5/T-SM6）", () => {
  it("同 provider+vendor 可 insert 两行且 settings 独立", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const a = await bundle.providerModels.save("openai", "gpt-4o", "preset-a");
    const b = await bundle.providerModels.save("openai", "gpt-4o", "preset-b");
    assert.notEqual(a.id, b.id);
    assert.equal(a.vendorModelId, b.vendorModelId);
    await bundle.providerModels.updateSettings(a.id, { thinkingLevel: "low" });
    await bundle.providerModels.updateSettings(b.id, { thinkingLevel: "high" });
    const refA = await bundle.providerModels.getSavedById(a.id);
    const refB = await bundle.providerModels.getSavedById(b.id);
    assert.equal(refA?.settings.generation.thinkingLevel, "low");
    assert.equal(refB?.settings.generation.thinkingLevel, "high");
  });

  it("save 第二次同 vendor 新增行（非 upsert）", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const vendor = `gpt-4o-dup-${Date.now()}`;
    const before = (await bundle.providerModels.savedList("openai")).length;
    const first = await bundle.providerModels.save("openai", vendor);
    const second = await bundle.providerModels.save("openai", vendor);
    assert.notEqual(first.id, second.id);
    const list = await bundle.providerModels.savedList("openai");
    assert.equal(list.length, before + 2);
    assert.equal(list.filter((m) => m.vendorModelId === vendor).length, 2);
  });
});

describe("ProviderModelService editSaved（T-SM14/T-SM15）", () => {
  it("默认 modelName=vendor 时 displayName 等于 legacy path", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create("openai", "gpt-4o");
    assert.equal(saved.modelName, "gpt-4o");
    assert.equal(
      savedModelDisplayName(saved),
      formatSavedModelDisplayName("openai", "gpt-4o"),
    );
  });

  it("省略 modelName 时不改名；空字符串拒绝", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const created = await bundle.providerModels.create("openai", "manual-model");
    await bundle.providerModels.editSaved(created.id, "Label A");
    const after = await bundle.providerModels.editSaved(created.id);
    assert.equal(after.modelName, "Label A");
    await assert.rejects(
      () => bundle.providerModels.editSaved(created.id, ""),
      (e) => e instanceof ProviderError && e.code === "INVALID_MODEL_NAME",
    );
  });
});

describe("ProviderModelService deleteSaved（T-SM8）", () => {
  it("currentModelId 引用时拒绝删除", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create("openai", "gpt-4o");
    const state = createPersistentState(ctx.conn);
    await state.setCurrentModelId(saved.id);
    await assert.rejects(
      () => bundle.providerModels.deleteSaved(saved.id),
      (e) => e instanceof ProviderError && e.code === "SAVED_MODEL_IN_USE",
    );
  });

  it("agent_definition.model pin 引用时拒绝删除", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create("openai", "gpt-4o");
    const registry = createAgentRegistryService(ctx.conn);
    await registry.upsert(
      `agent-pin-${randomUUID()}`,
      decode(
        {
          schemaVersion: 1,
          name: `pin-agent-${Date.now()}`,
          prompts: { persist: {}, dynamic: {} },
          model: saved.id,
        },
        agentDefinitionSchema,
      ),
    );
    await assert.rejects(
      () => bundle.providerModels.deleteSaved(saved.id),
      (e) => e instanceof ProviderError && e.code === "SAVED_MODEL_IN_USE",
    );
  });

  it("chat_project.agent_config_json.model pin 引用时拒绝删除", async () => {
    const ctx = getNovelMasterTestContext();
    const bundle = createProviderServices(ctx.conn, memorySecretStore());
    const saved = await bundle.providerModels.create("openai", "gpt-4o");
    const project = await ctx.projects.create(`proj-pin-${Date.now()}`);
    await ctx.projects.updateAgentConfig(project.id, {
      mode: "custom",
      definition: decode(
        {
          schemaVersion: 1,
          name: "project-pin",
          prompts: { persist: {}, dynamic: {} },
          model: saved.id,
        },
        agentDefinitionSchema,
      ),
    });
    await assert.rejects(
      () => bundle.providerModels.deleteSaved(saved.id),
      (e) => e instanceof ProviderError && e.code === "SAVED_MODEL_IN_USE",
    );
  });
});
