import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderError } from "../../src/errors/provider-errors.js";
import { DefaultModelRequestService } from "../../src/service/provider/impl/model-request.service.js";
import type { LlmProtocolAdapter } from "../../src/infra/llm-protocol/ports/adapter.port.js";
import type { ProviderRepository } from "../../src/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "../../src/domain/provider/repositories/saved-model.port.js";
import type { SecretStore } from "../../src/infra/sksp/ports/secret-store.port.js";
import type { ModelRetryPolicyService } from "../../src/service/provider/model-retry-policy.port.js";
import { defaultSavedModelSettings } from "../../src/domain/provider/model/default-saved-model-settings.js";

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

const SAVED_MODEL_ID = "00000000-0000-4000-8000-000000000001";

const savedModels: SavedModelRepository = {
  listByProvider: async () => [],
  findById: async (id) =>
    id === SAVED_MODEL_ID
      ? {
          id: SAVED_MODEL_ID,
          providerId: "openai",
          vendorModelId: "gpt-4o-mini",
          modelName: "gpt-4o-mini",
          settings: defaultSavedModelSettings("gpt-4o-mini"),
          createdAtMs: 0,
          updatedAtMs: 0,
        }
      : null,
  insert: async () => undefined,
  updateById: async () => undefined,
  deleteById: async () => false,
  deleteByProvider: async () => undefined,
};

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
      retryPolicies: noRetryPolicies,
      retryPolicy: { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
      resolveAdapter: () => adapter,
    });
    const out = await svc.request(SAVED_MODEL_ID, "hello");
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
      retryPolicies: noRetryPolicies,
      retryPolicy: { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
      resolveAdapter: () => adapter,
    });
    await assert.rejects(() => svc.request(SAVED_MODEL_ID, "hello"));
    assert.equal(calls, 1);
  });

  it("retries on 429 then succeeds", async () => {
    let calls = 0;
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async () => {
        calls += 1;
        if (calls === 1) {
          throw new ProviderError("HTTP_ERROR", "HTTP 429: rate limited");
        }
        return { assistantText: "ok", blocks: [{ type: "text", text: "ok" }], raw: {} };
      },
    };
    const svc = new DefaultModelRequestService({
      providers: providerRepo,
      savedModels,
      secretStore,
      retryPolicies: noRetryPolicies,
      retryPolicy: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
      resolveAdapter: () => adapter,
    });
    const out = await svc.request(SAVED_MODEL_ID, "hello");
    assert.equal(out.assistantText, "ok");
    assert.equal(calls, 2);
  });

  it("retries on network failures then succeeds", async () => {
    let calls = 0;
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error("ECONNRESET");
        }
        return { assistantText: "ok", blocks: [{ type: "text", text: "ok" }], raw: {} };
      },
    };
    const svc = new DefaultModelRequestService({
      providers: providerRepo,
      savedModels,
      secretStore,
      retryPolicies: noRetryPolicies,
      retryPolicy: { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
      resolveAdapter: () => adapter,
    });
    const out = await svc.request(SAVED_MODEL_ID, "hello");
    assert.equal(out.assistantText, "ok");
    assert.equal(calls, 3);
  });

  it("fails explicitly after exceeding maxRetries", async () => {
    let calls = 0;
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async () => {
        calls += 1;
        throw new ProviderError("HTTP_ERROR", "HTTP 500: upstream");
      },
    };
    const svc = new DefaultModelRequestService({
      providers: providerRepo,
      savedModels,
      secretStore,
      retryPolicies: noRetryPolicies,
      retryPolicy: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
      resolveAdapter: () => adapter,
    });
    await assert.rejects(
      () => svc.request(SAVED_MODEL_ID, "hello"),
      (error: unknown) =>
        error instanceof ProviderError && error.code === "HTTP_ERROR",
    );
    assert.equal(calls, 3);
  });

  it("does not retry when signal aborts before retry", async () => {
    let calls = 0;
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async () => {
        calls += 1;
        throw new ProviderError("HTTP_ERROR", "HTTP 500: upstream");
      },
    };
    const svc = new DefaultModelRequestService({
      providers: providerRepo,
      savedModels,
      secretStore,
      retryPolicies: noRetryPolicies,
      retryPolicy: { maxRetries: 3, baseDelayMs: 50, maxDelayMs: 50, jitterRatio: 0 },
      resolveAdapter: () => adapter,
    });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() =>
      svc.request(SAVED_MODEL_ID, "hello", { signal: controller.signal }),
    );
    assert.equal(calls, 1);
  });

  it("surfaces HTTP 400 without DOMException global (React Native Hermes)", async () => {
    const g = globalThis as { DOMException?: typeof DOMException };
    const savedDom = g.DOMException;
    // @ts-expect-error simulate Hermes missing DOMException
    delete g.DOMException;
    let calls = 0;
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async () => {
        calls += 1;
        throw new ProviderError("HTTP_ERROR", "HTTP 400: bad request");
      },
    };
    const svc = new DefaultModelRequestService({
      providers: providerRepo,
      savedModels,
      secretStore,
      retryPolicies: noRetryPolicies,
      retryPolicy: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
      resolveAdapter: () => adapter,
    });
    try {
      await assert.rejects(
        () => svc.request(SAVED_MODEL_ID, "hello"),
        (error: unknown) =>
          error instanceof ProviderError && error.code === "HTTP_ERROR",
      );
      assert.equal(calls, 1);
    } finally {
      if (savedDom !== undefined) {
        g.DOMException = savedDom;
      }
    }
  });
});
