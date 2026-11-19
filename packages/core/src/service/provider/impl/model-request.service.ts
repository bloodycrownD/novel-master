/**
 * LLM chat request for saved models.
 *
 * @module service/provider/impl/model-request.service
 */

import { AppError, isAppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { inDomain } from "@/errors/guards.js";
import { SavedModelUuid } from "@/domain/provider/logic/assert-saved-model-uuid.js";
import { ThinkingLevelPresets } from "@/domain/provider/logic/thinking-level-presets.js";
import { ProviderApiKey } from "@/domain/provider/logic/resolve-provider-api-key.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import { getProtocolAdapter } from "@/infra/llm-protocol/logic/registry.js";
import type { LlmChatResult, LlmProtocolAdapter, LlmProtocolKind, LlmStreamEvent } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import type { ModelRetryPolicy, ModelRetryPolicyService } from "../model-retry-policy.port.js";
import type { ModelRequestOptions, ModelRequestService } from "../model-request.port.js";
import { isAbortLikeError } from "@/infra/llm-protocol/logic/request-abort.js";
import { AbortError } from "@/domain/abort/logic/create-abort-error.js";
import { AbortScopeFactory } from "@/domain/abort/logic/create-abort-scope.js";

interface DefaultModelRequestServiceDeps {
  readonly providers: ProviderRepository;
  readonly savedModels: SavedModelRepository;
  readonly secretStore: SecretStore;
  /**
   * Optional persisted retry policy (KKV-backed via {@link ModelRetryPolicyService}).
   *
   * WHY: provider services wire storage concerns; request service only consumes a port.
   */
  readonly retryPolicies?: ModelRetryPolicyService;
  /** Optional explicit retry policy override (tests / callers without storage). */
  readonly retryPolicy?: ModelRetryPolicy;
  readonly resolveAdapter?: (kind: LlmProtocolKind) => LlmProtocolAdapter;
}

const DEFAULT_RETRY_POLICY = {
  maxRetries: 2,
  baseDelayMs: 200,
  maxDelayMs: 2_000,
  jitterRatio: 0.2,
} as const;

/**
 * 「本 attempt 已产出可见内容」的可判据事件族。
 *
 * 与 `agent-runner.ts` 记 `firstContentAtMs` 用的 `text-delta || thinking-delta`
 * 同族，另加 `tool-use`（工具调用同样已对用户可见）。
 * ⚠️ `usage` / `done` **不置闩**：它们不承载可见输出。若把它们也算「已产出」，
 * 「只收到一个 usage 就断流」的黑洞会被误判成已产出而彻底不重试——
 * 那是把重试闩锁修成反向 bug。
 */
const PRODUCED_EVENT_TYPES = new Set<LlmStreamEvent["type"]>(["text-delta", "thinking-delta", "tool-use"]);

/**
 * 重试策略矩阵：abort 形态 / 流超时相位 / 领域错误 / HTTP 状态四段判定。
 *
 * nm-style: keep-local — 分支顺序本身就是不变量（超时相位必须先于「非 PROVIDER_* 默认 true」，
 * abort 文本判定又必须先于「无状态码默认可重试」）；内联进 catch 会把顺序敏感的矩阵拆进重试编排。
 */
function isRetryableError(error: unknown): boolean {
  if (isAbortLikeError(error)) {
    return false;
  }
  // 流式超时分级（spec llm-stream-timeout 回炉版）：0 字节耗尽整调用预算
  // （黑洞形态）无任何输出、无副作用，与 429/5xx 同列可重试；流中断（idle，
  // 已有部分输出）不重试，避免重复输出/重复计费。本分支必须置于下方
  // 「非 PROVIDER_* AppError 默认 true」之前——否则 idle 超时会被当未知瞬时错误
  // 误判为可重试。
  if (isAppError(error, "PROVIDER_STREAM_TIMEOUT")) {
    return error.details?.phase === "first-chunk";
  }
  if (!inDomain(error, "PROVIDER")) {
    // Unknown transport/runtime failures are treated as transient once.
    return true;
  }
  // abort 形态的 PROVIDER_HTTP_ERROR（XHR onabort 链 reject 的 "Request aborted"）
  // 绝不可重试：一旦因时序窗口逃离 adapter 的 isRequestAborted 吞错
  // （signal 晚于错误判定等竞态），若落入下方「无状态码 → 默认可重试」
  // 分支，用户停止会触发自动重发形成僵尸循环（黑洞复现实验 r3 实锤）。
  // 口径与 request-abort.ts 的 isRequestAborted 第三判据对齐。
  if (error.message.toLowerCase().includes("abort")) {
    return false;
  }
  if (error.key !== "PROVIDER_HTTP_ERROR") {
    return false;
  }
  const matched = /HTTP\s+(\d{3})/.exec(error.message);
  if (matched == null) {
    return true;
  }
  const status = Number(matched[1]);
  return status === 429 || status >= 500;
}

/**
 * nm-style: keep-local — timer 与 abort listener 必须成对注册/移除（生命周期不变量），
 * 内联进重试分支会把清理句柄拆散，泄漏 timer 或触发已 settle 的 reject。
 */
async function delayWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(AbortError.create());
    };
    if (signal == null) {
      return;
    }
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Sends chat requests via protocol adapters. */
export class DefaultModelRequestService implements ModelRequestService {
  constructor(private readonly deps: DefaultModelRequestServiceDeps) {}

  async request(savedModelId: string, userContent: string, options?: ModelRequestOptions): Promise<Result<LlmChatResult, AppError>> {
    const asserted = await SavedModelUuid.assert(savedModelId, this.deps.savedModels);
    if (!asserted.ok) {
      return Result.err(new AppError("PROVIDER_MODEL_NOT_SAVED", { detail: `Model not saved: ${savedModelId}. Fetch and save the model first.`, modelId: savedModelId }));
    }
    const saved = asserted.value;
    const { providerId, vendorModelId } = saved;
    const provider = await this.deps.providers.findById(providerId);
    if (!provider.ok || provider.value == null) {
      return Result.err(new AppError("PROVIDER_NOT_FOUND", { detail: `Provider not found: ${providerId}`, providerId }));
    }
    const row = provider.value;
    const apiKeyResult = await ProviderApiKey.resolve(row, this.deps.secretStore);
    if (!apiKeyResult.ok) {
      return Result.err(new AppError("PROVIDER_API_KEY_NOT_SET", { detail: apiKeyResult.error.message, providerId: row.id }));
    }
    const apiKey = apiKeyResult.value;
    let sampling = options?.sampling;
    if (sampling === undefined) {
      const savedSampling = saved.settings.generation.sampling;
      if (savedSampling.enabled && savedSampling.params != null) {
        sampling = savedSampling.params;
      }
    }

    let thinking = options?.thinking;
    if (thinking === undefined) {
      const thinkingLevel = saved.settings.generation.thinkingLevel;
      if (thinkingLevel !== "off") {
        thinking = ThinkingLevelPresets.toModelThinkingParams(thinkingLevel, row.protocol, vendorModelId, saved.settings.generation.sampling);
      }
    }

    const resolveAdapter = this.deps.resolveAdapter ?? getProtocolAdapter;
    const adapter = resolveAdapter(row.protocol);
    // 无 options 的调用方显式表达「不可取消」：建一个无定时器、无父的 scope。
    const scope = options?.scope ?? AbortScopeFactory.create();
    let policy = this.deps.retryPolicy ?? DEFAULT_RETRY_POLICY;
    if (this.deps.retryPolicies != null) {
      const fetched = await this.deps.retryPolicies.getPolicy();
      if (!fetched.ok) return Result.err(fetched.error);
      if (fetched.value != null) {
        policy = fetched.value;
      }
    }
    let attempt = 0;
    // 「本 attempt 是否已产出」闩锁：只看错误形态的重试判定会让「已流式吐了半段
    // 文本、随后传输层断掉」的请求再发一次 attempt ⇒ 同一段文本在屏幕上出现两遍、
    // 服务商按两次完整生成计费、run 级 usage 基线被重复累加。
    let attemptEmitted = false;
    while (true) {
      attempt += 1;
      // ⚠️ **逐 attempt 复位**（不是为了语义，而是为了让闩锁的正确性不依赖
      // 「重试只发生在未产出时」这条当前恰好成立的不变量——将来若引入任何
      // 「已产出后续传」类策略，逐 attempt 复位是它能成立的前提）。
      attemptEmitted = false;
      // 非流式请求直接传 undefined、**不要造闭包**（不该凭空多一层）。
      let onStream: ((event: LlmStreamEvent) => void) | undefined;
      if (options?.onStream != null) {
        onStream = (ev) => {
          // ⚠️ **先置闩、再转发**：顺序反了的话，一旦下游 onStream 自身抛错，
          // 闩锁会来不及置位 ⇒ 变成静默可重试。
          if (PRODUCED_EVENT_TYPES.has(ev.type)) {
            attemptEmitted = true;
          }
          options.onStream!(ev);
        };
      }
      try {
        // 传输层失败仍沿 throw 通道（retry 按 catch + code 分派，spec-2-core §2.1 D 类），
        // 只有预检失败（上方三处 + policy 读取）走 `Result.err`。
        const chatArgs = {
          baseUrl: row.baseUrl,
          apiKey,
          vendorModelId,
          userContent,
          extraHeaders: row.headers,
          extraBody: row.bodyParams,
          history: options?.history,
          toolUseLookupMessages: options?.toolUseLookupMessages,
          system: options?.system,
          tools: options?.tools,
          stream: options?.stream,
          onStream,
          sampling,
          thinking,
          scope,
        };
        return Result.ok(await adapter.chat(chatArgs));
      } catch (error) {
        const canRetry = attempt <= policy.maxRetries && !attemptEmitted && isRetryableError(error);
        // WHY: cancel must short-circuit retries so terminate actions feel immediate.
        if (!canRetry || isAbortLikeError(error)) {
          throw error;
        }
        const retryPolicy = policy ?? DEFAULT_RETRY_POLICY;
        const baseDelay = Math.min(retryPolicy.baseDelayMs * 2 ** Math.max(0, attempt - 1), retryPolicy.maxDelayMs);
        const jitterRange = baseDelay * retryPolicy.jitterRatio;
        await delayWithSignal(Math.max(0, Math.round(baseDelay + (Math.random() * 2 - 1) * jitterRange)), scope.signal);
      }
    }
  }
}
