/**
 * Default {@link ModelRetryPolicyService} backed by internal KKV.
 *
 * KKV key: `policy`
 *
 * @module service/provider/impl/model-retry-policy.service
 */

import { AppError, isAppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type {
  ModelRetryPolicy,
  ModelRetryPolicyService,
} from "../model-retry-policy.port.js";

/** KKV module for global model retry policy (provider transient failures). */
const MODULE = "nm-model-retry";
const KEY = "policy";

function validatePolicy(input: ModelRetryPolicy): Result<void, AppError<"PROVIDER_INVALID_ARGUMENT">> {
  const invalid = (message: string) => Result.err(new AppError("PROVIDER_INVALID_ARGUMENT", { detail: `Invalid retry policy: ${message}` }));
  if (!Number.isFinite(input.maxRetries) || input.maxRetries < 0) {
    return invalid("maxRetries must be >= 0");
  }
  if (!Number.isFinite(input.baseDelayMs) || input.baseDelayMs < 0) {
    return invalid("baseDelayMs must be >= 0");
  }
  if (!Number.isFinite(input.maxDelayMs) || input.maxDelayMs < 0) {
    return invalid("maxDelayMs must be >= 0");
  }
  if (input.maxDelayMs < input.baseDelayMs) {
    return invalid("maxDelayMs must be >= baseDelayMs");
  }
  if (
    !Number.isFinite(input.jitterRatio) ||
    input.jitterRatio < 0 ||
    input.jitterRatio > 1
  ) {
    return invalid("jitterRatio must be in [0, 1]");
  }
  return Result.ok<void>(undefined);
}

/** Persists retry policy in novel.db KKV. */
export class DefaultModelRetryPolicyService implements ModelRetryPolicyService {
  constructor(private readonly kkv: KkvService) {}

  async getPolicy(): Promise<Result<ModelRetryPolicy | null, AppError>> {
    const raw = await this.kkv.get(MODULE, KEY);
    if (!raw.ok) {
      if (isAppError(raw.error, "KKV_NOT_FOUND")) {
        return Result.ok(null);
      }
      return Result.err(raw.error);
    }
    try {
      const parsed = JSON.parse(raw.value) as Partial<ModelRetryPolicy>;
      const policy: ModelRetryPolicy = {
        maxRetries: Number(parsed.maxRetries),
        baseDelayMs: Number(parsed.baseDelayMs),
        maxDelayMs: Number(parsed.maxDelayMs),
        jitterRatio: Number(parsed.jitterRatio),
      };
      const valid = validatePolicy(policy);
      // Treat invalid stored values as "unset" to avoid bricking requests.
      return Result.ok(valid.ok ? policy : null);
    } catch {
      return Result.ok(null);
    }
  }

  /** 校验失败（`validatePolicy` 的 `Result.err`）原样接力，由上层决定提示。 */
  async setPolicy(policy: ModelRetryPolicy): Promise<Result<void, AppError>> {
    const valid = validatePolicy(policy);
    if (!valid.ok) return Result.err(valid.error);
    // WHY: serialized config must be stable across runtimes (CLI/mobile); JSON is the boundary.
    await this.kkv.set(MODULE, KEY, JSON.stringify(policy));
    return Result.ok(undefined);
  }

  /** `KKV_NOT_FOUND` 幂等归一为成功；其余 KKV 失败经 `Result.err` 原样接力。 */
  async clearPolicy(): Promise<Result<void, AppError>> {
    const deleted = await this.kkv.delete(MODULE, KEY);
    if (!deleted.ok && !isAppError(deleted.error, "KKV_NOT_FOUND")) return deleted;
    return Result.ok(undefined);
  }
}
