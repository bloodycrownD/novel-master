import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderError } from "../../src/errors/provider-errors.js";
import { DefaultModelRequestService } from "../../src/service/provider/impl/model-request.service.js";
import type { LlmProtocolAdapter } from "../../src/infra/llm-protocol/ports/adapter.port.js";
import type { ProviderRepository } from "../../src/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "../../src/domain/provider/repositories/saved-model.port.js";
import type { SecretStore } from "../../src/infra/sksp/ports/secret-store.port.js";
import type { ModelSamplingProfileService } from "../../src/service/provider/model-sampling-profile.port.js";

const providerRepo: ProviderRepository = {
  list: async () => [],
  findById: async () => ({
    id: "openai",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    displayName: "OpenAI",
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
    providerId: "openai",
    vendorModelId: "gpt-4o-mini",
    displayName: "gpt-4o-mini",
    createdAtMs: 0,
    updatedAtMs: 0,
  }),
  insert: async () => undefined,
  update: async () => undefined,
  delete: async () => false,
  deleteByProvider: async () => undefined,
};

const secretStore: SecretStore = {
  get: async () => "k",
  set: async () => undefined,
  delete: async () => undefined,
};

const samplingProfiles: ModelSamplingProfileService = {
  getProfile: async () => null,
  setProfile: async () => undefined,
  clearProfile: async () => undefined,
};

describe("DefaultModelRequestService retry", () => {
  it("retries transient HTTP failures then succeeds", async () => {
    let calls = 0;
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async () => {
        calls += 1;
        if (calls < 3) {
          throw new ProviderError("HTTP_ERROR", "HTTP 500: upstream");
        }
        return { assistantText: "ok", blocks: [{ type: "text", text: "ok" }], raw: {} };
      },
    };
    const svc = new DefaultModelRequestService({
      providers: providerRepo,
      savedModels,
      secretStore,
      samplingProfiles,
      retryPolicy: { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
      resolveAdapter: () => adapter,
    });
    const out = await svc.request("openai/gpt-4o-mini", "hello");
    assert.equal(out.assistantText, "ok");
    assert.equal(calls, 3);
  });

  it("does not retry on abort error", async () => {
    let calls = 0;
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async () => {
        calls += 1;
        throw new DOMException("aborted", "AbortError");
      },
    };
    const svc = new DefaultModelRequestService({
      providers: providerRepo,
      savedModels,
      secretStore,
      samplingProfiles,
      retryPolicy: { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
      resolveAdapter: () => adapter,
    });
    await assert.rejects(() => svc.request("openai/gpt-4o-mini", "hello"));
    assert.equal(calls, 1);
  });
});
