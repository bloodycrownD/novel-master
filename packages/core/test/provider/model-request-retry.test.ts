import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILTIN_PROVIDER_UUID_OPENAI } from "../../src/domain/provider/logic/builtin-providers.js";
import { ProviderError } from "../../src/errors/provider-errors.js";
import { DefaultModelRequestService } from "../../src/service/provider/impl/model-request.service.js";
import type { LlmProtocolAdapter } from "../../src/infra/llm-protocol/ports/adapter.port.js";
import type { ProviderRepository } from "../../src/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "../../src/domain/provider/repositories/saved-model.port.js";
import type { SecretStore } from "../../src/infra/sksp/ports/secret-store.port.js";
import type { ModelRetryPolicyService } from "../../src/service/provider/model-retry-policy.port.js";
import { defaultSavedModelSettings } from "../../src/domain/provider/model/default-saved-model-settings.js";
import { LlmStreamTimeoutError } from "../../src/infra/llm-protocol/logic/llm-stream-timeout-error.js";

const providerRepo: ProviderRepository = {
  list: async () => [],
  findById: async () => ({
    id: BUILTIN_PROVIDER_UUID_OPENAI,
    builtinKey: null,
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
          providerId: BUILTIN_PROVIDER_UUID_OPENAI,
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

  it("T-D7: abort 形态 ProviderError（'Request aborted' 逃离 adapter 吞错窗口）绝不重试", async () => {
    let calls = 0;
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async () => {
        calls += 1;
        // 黑洞复现实验 r3 实锤形态：用户停止后 onabort 链 reject 的错误
        // 若逃离 adapter 吞错，不得落入「无状态码 → 默认可重试」触发僵尸重发
        throw new ProviderError("HTTP_ERROR", "Request aborted");
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
    await assert.rejects(
      () => svc.request(SAVED_MODEL_ID, "hello"),
      (error: unknown) =>
        error instanceof ProviderError && error.code === "HTTP_ERROR",
    );
    assert.equal(calls, 1, "abort 形态错误不应重试");
  });

  it("T-T4: 首字前流式超时（first-chunk，黑洞耗尽整调用预算）按既有上限重试后成功", async () => {
    let calls = 0;
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async () => {
        calls += 1;
        if (calls < 3) {
          // 传输层首字超时：无任何输出、无副作用，应与 429/5xx 同列可重试
          throw new LlmStreamTimeoutError("first-chunk", 120_000);
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
    assert.equal(calls, 3, "first-chunk 超时应按既有重试上限重试");
  });

  it("T-T4: 流中断超时（idle，已有部分输出）不可重试，直接上抛", async () => {
    let calls = 0;
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async () => {
        calls += 1;
        // 流中断：已有部分输出，不重试（避免重复输出/重复计费）
        throw new LlmStreamTimeoutError("idle", 90_000);
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
    await assert.rejects(
      () => svc.request(SAVED_MODEL_ID, "hello"),
      (error: unknown) =>
        error instanceof LlmStreamTimeoutError && error.phase === "idle",
    );
    assert.equal(calls, 1, "idle 超时不应重试");
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

  it("T-RR-1: 已产出 text-delta 后中途失败：不得二次驱动 onStream（不重复输出/不重复计费）", async () => {
    // 裸 Error ⇒ isRetryableError 判 true，这是**修复前必然重试**的路径——正是牙齿所在。
    let calls = 0;
    const seen: string[] = [];
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async (req) => {
        calls += 1;
        req.onStream?.({ type: "text-delta", text: "半句" });
        throw new Error("ECONNRESET");
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

    await assert.rejects(() =>
      svc.request(SAVED_MODEL_ID, "hello", {
        stream: true,
        onStream: (ev) => {
          if (ev.type === "text-delta") seen.push(ev.text);
        },
      }),
    );
    assert.equal(calls, 1, "已产出后不得发起第二次 attempt");
    assert.equal(seen.length, 1, "onStream 只被驱动一次");
    assert.deepEqual(seen, ["半句"]);
  });

  it("T-RR-1b: 无产出仍可重试（闩锁不得掐死瞬时失败重试）", async () => {
    // 同时是「逐 attempt 复位」的行为证据：第二次 attempt 的 emit 必须照常转发。
    let calls = 0;
    const seen: string[] = [];
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async (req) => {
        calls += 1;
        if (calls === 1) {
          throw new Error("ECONNRESET"); // 不 emit
        }
        req.onStream?.({ type: "text-delta", text: "ok" });
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

    const out = await svc.request(SAVED_MODEL_ID, "hello", {
      stream: true,
      onStream: (ev) => {
        if (ev.type === "text-delta") seen.push(ev.text);
      },
    });
    assert.equal(calls, 2);
    assert.equal(out.assistantText, "ok");
    assert.deepEqual(seen, ["ok"]);
  });

  it("T-RR-1c: 已产出的 idle 超时仍不重试（两条路径并存、归因不漂移）", async () => {
    // 证明 §修法 5：闩锁与 `LlmStreamTimeoutError.phase` 分级**并存**而非互相顶掉。
    // 若实现把 `:78-80` 改写成「先看闩锁再判 phase」，这条的失败归因会变得不可分辨。
    let calls = 0;
    const seen: string[] = [];
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async (req) => {
        calls += 1;
        req.onStream?.({ type: "text-delta", text: "半句" });
        throw new LlmStreamTimeoutError("idle", 90_000);
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

    await assert.rejects(
      () =>
        svc.request(SAVED_MODEL_ID, "hello", {
          stream: true,
          onStream: (ev) => {
            if (ev.type === "text-delta") seen.push(ev.text);
          },
        }),
      (error: unknown) =>
        error instanceof LlmStreamTimeoutError && error.phase === "idle",
    );
    assert.equal(calls, 1);
    assert.equal(seen.length, 1);
  });

  it("T-RR-1d: 只收到 usage/done 后断流仍可重试（黑洞不得被闩锁误判成已产出）", async () => {
    // usage / done 不承载可见输出 ⇒ 不置闩。若把它们也算「已产出」，
    // 「只收到一个 usage 就断流」的黑洞会被彻底不重试——反向 bug。
    let calls = 0;
    const adapter: LlmProtocolAdapter = {
      kind: "openai",
      listModels: async () => ({ models: [] }),
      chat: async (req) => {
        calls += 1;
        if (calls === 1) {
          req.onStream?.({
            type: "usage",
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          });
          req.onStream?.({
            type: "done",
            result: {
              assistantText: "",
              blocks: [],
              raw: {},
            },
          });
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

    const out = await svc.request(SAVED_MODEL_ID, "hello", {
      stream: true,
      onStream: () => undefined,
    });
    assert.equal(calls, 2);
    assert.equal(out.assistantText, "ok");
  });
});
