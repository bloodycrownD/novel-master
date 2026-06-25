import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DefaultModelRequestService } from "../../src/service/provider/impl/model-request.service.js";
import type { LlmChatRequest, LlmProtocolAdapter } from "../../src/infra/llm-protocol/ports/adapter.port.js";
import type { ProviderRepository } from "../../src/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "../../src/domain/provider/repositories/saved-model.port.js";
import type { SecretStore } from "../../src/infra/sksp/ports/secret-store.port.js";
import type { ModelRetryPolicyService } from "../../src/service/provider/model-retry-policy.port.js";
import { defaultSavedModelSettings } from "../../src/domain/provider/model/default-saved-model-settings.js";
import type { SavedModelSettings } from "../../src/domain/provider/model/saved-model-settings.js";

const secretStore: SecretStore = {
  get: async () => "k",
  set: async () => undefined,
  delete: async () => undefined,
};

const noRetryPolicies: ModelRetryPolicyService = {
  getPolicy: async () => null,
  setPolicy: async () => undefined,
  clearPolicy: async () => undefined,
};

function createService(
  settings: SavedModelSettings,
  protocol: "openai" | "anthropic" | "gemini",
  onChat: (req: LlmChatRequest) => void,
) {
  const providerRepo: ProviderRepository = {
    list: async () => [],
    findById: async () => ({
      id: protocol,
      protocol,
      baseUrl: "https://api.example.com/v1",
      displayName: protocol,
      secretRef: null,
      headers: {},
      isBuiltin: false,
      createdAtMs: 0,
      updatedAtMs: 0,
    }),
    insert: async () => undefined,
    update: async () => undefined,
    delete: async () => false,
  };

  const savedModels: SavedModelRepository = {
    listByProvider: async () => [],
    find: async () => ({
      providerId: protocol,
      vendorModelId: "test-model",
      displayName: "test-model",
      settings,
      createdAtMs: 0,
      updatedAtMs: 0,
    }),
    insert: async () => undefined,
    update: async () => undefined,
    delete: async () => false,
    deleteByProvider: async () => undefined,
  };

  const adapter: LlmProtocolAdapter = {
    kind: protocol,
    listModels: async () => ({ models: [] }),
    chat: async (req) => {
      onChat(req);
      return { assistantText: "ok", blocks: [{ type: "text", text: "ok" }], raw: {} };
    },
  };

  return new DefaultModelRequestService({
    providers: providerRepo,
    savedModels,
    secretStore,
    retryPolicies: noRetryPolicies,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    resolveAdapter: () => adapter,
  });
}

describe("DefaultModelRequestService thinking", () => {
  it("thinking 关闭时不向 adapter 传 thinking", async () => {
    let captured: LlmChatRequest | undefined;
    const settings = defaultSavedModelSettings("gpt-4o");
    const svc = createService(settings, "openai", (req) => {
      captured = req;
    });

    await svc.request("openai/test-model", "hello");

    assert.equal(captured?.thinking, undefined);
  });

  it("thinking 开启时解析并传给 adapter", async () => {
    let captured: LlmChatRequest | undefined;
    const settings: SavedModelSettings = {
      ...defaultSavedModelSettings("gpt-4o"),
      generation: {
        sampling: { enabled: false },
        thinking: { enabled: true },
      },
    };
    const svc = createService(settings, "openai", (req) => {
      captured = req;
    });

    await svc.request("openai/test-model", "hello");

    assert.deepEqual(captured?.thinking, {
      protocol: "openai",
      openai: { reasoning_effort: "medium" },
    });
  });

  it("options.thinking 覆盖已保存设置", async () => {
    let captured: LlmChatRequest | undefined;
    const settings: SavedModelSettings = {
      ...defaultSavedModelSettings("gpt-4o"),
      generation: {
        sampling: { enabled: false },
        thinking: { enabled: false },
      },
    };
    const svc = createService(settings, "openai", (req) => {
      captured = req;
    });

    await svc.request("openai/test-model", "hello", {
      thinking: { protocol: "openai", openai: { reasoning_effort: "high" } },
    });

    assert.deepEqual(captured?.thinking, {
      protocol: "openai",
      openai: { reasoning_effort: "high" },
    });
  });
});
