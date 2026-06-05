/**
 * LLM chat request for saved models.
 *
 * @module service/provider/impl/model-request.service
 */

import { ProviderError } from "@/errors/provider-errors.js";
import { parseApplicationModelId } from "@/domain/provider/logic/application-model-id.js";
import { providerApiKeyRef } from "@/domain/provider/model/provider.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import { getProtocolAdapter } from "@/infra/llm-protocol/logic/registry.js";
import type {
  LlmChatResult,
  LlmProtocolAdapter,
  LlmProtocolKind,
} from "@/infra/llm-protocol/ports/adapter.port.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import type {
  ModelRetryPolicy,
  ModelRetryPolicyService,
} from "../model-retry-policy.port.js";
import type {
  ModelRequestOptions,
  ModelRequestService,
} from "../model-request.port.js";
import {
  createAbortError,
  isAbortLikeError,
} from "@/infra/llm-protocol/logic/request-abort.js";

export interface DefaultModelRequestServiceDeps {
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

function parseHttpStatusFromProviderError(error: ProviderError): number | undefined {
  const m = /HTTP\s+(\d{3})/.exec(error.message);
  if (m == null) {
    return undefined;
  }
  return Number(m[1]);
}

function isRetryableError(error: unknown): boolean {
  if (isAbortLikeError(error)) {
    return false;
  }
  if (!(error instanceof ProviderError)) {
    // Unknown transport/runtime failures are treated as transient once.
    return true;
  }
  if (error.code !== "HTTP_ERROR") {
    return false;
  }
  const status = parseHttpStatusFromProviderError(error);
  if (status == null) {
    return true;
  }
  return status === 429 || status >= 500;
}

function computeBackoffMs(
  attempt: number,
  policy: ModelRetryPolicy | undefined,
): number {
  const p = policy ?? DEFAULT_RETRY_POLICY;
  const base = Math.min(p.baseDelayMs * 2 ** Math.max(0, attempt - 1), p.maxDelayMs);
  const jitterRange = base * p.jitterRatio;
  return Math.max(0, Math.round(base + (Math.random() * 2 - 1) * jitterRange));
}

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
      reject(createAbortError());
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

  async request(
    applicationModelId: string,
    userContent: string,
    options?: ModelRequestOptions,
  ): Promise<LlmChatResult> {
    const { providerId, vendorModelId } =
      parseApplicationModelId(applicationModelId);
    const saved = await this.deps.savedModels.find(providerId, vendorModelId);
    if (!saved) {
      throw new ProviderError(
        "MODEL_NOT_SAVED",
        `Model not saved: ${applicationModelId} (run: nm provider model save --vendorModelId ${vendorModelId})`,
        { modelId: applicationModelId, providerId },
      );
    }
    const provider = await this.deps.providers.findById(providerId);
    if (!provider) {
      throw new ProviderError("NOT_FOUND", `Provider not found: ${providerId}`, {
        providerId,
      });
    }
    const ref = provider.secretRef ?? providerApiKeyRef(providerId);
    const apiKey = await this.deps.secretStore.get(ref);
    if (apiKey == null || apiKey === "") {
      throw new ProviderError(
        "API_KEY_NOT_SET",
        `API key not set for provider ${providerId} (run: nm provider edit --providerId ${providerId} --apiKey <key>)`,
        { providerId },
      );
    }
    let sampling = options?.sampling;
    if (sampling === undefined) {
      if (
        saved.settings.sampling.enabled &&
        saved.settings.sampling.params != null
      ) {
        sampling = saved.settings.sampling.params;
      }
    }

    const resolveAdapter = this.deps.resolveAdapter ?? getProtocolAdapter;
    const adapter = resolveAdapter(provider.protocol);
    const policy =
      (await this.deps.retryPolicies?.getPolicy()) ??
      this.deps.retryPolicy ??
      DEFAULT_RETRY_POLICY;
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        return await adapter.chat({
          baseUrl: provider.baseUrl,
          apiKey,
          vendorModelId,
          userContent,
          extraHeaders: provider.headers,
          history: options?.history,
          toolUseLookupMessages: options?.toolUseLookupMessages,
          system: options?.system,
          tools: options?.tools,
          stream: options?.stream,
          onStream: options?.onStream,
          sampling,
          signal: options?.signal,
        });
      } catch (error) {
        const canRetry =
          attempt <= policy.maxRetries && isRetryableError(error);
        // WHY: cancel must short-circuit retries so terminate actions feel immediate.
        if (!canRetry || isAbortLikeError(error)) {
          throw error;
        }
        await delayWithSignal(computeBackoffMs(attempt, policy), options?.signal);
      }
    }
  }
}
