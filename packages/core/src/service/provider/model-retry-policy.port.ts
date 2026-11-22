/**
 * Model retry policy storage port.
 *
 * @module service/provider/model-retry-policy.port
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

export interface ModelRetryPolicy {
    readonly maxRetries: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
    readonly jitterRatio: number;
}

export interface ModelRetryPolicyService {
    /**
   * Returns current retry policy, or null when unset (caller uses defaults);
   * 读失败走 `Result.err(AppError)`，存量坏值按既有口径视为未设置（null）。
   */
    getPolicy(): Promise<Result<ModelRetryPolicy | null, AppError>>;

    /**
   * Persists retry policy. Validation lives in the service impl:
   * 校验失败走 `Result.err(AppError)`；未知异常仍走 throw。
   */
    setPolicy(policy: ModelRetryPolicy): Promise<Result<void, AppError>>;

    /**
   * Clears persisted policy (falls back to defaults); `KKV_NOT_FOUND` 幂等归一为成功。
   */
    clearPolicy(): Promise<Result<void, AppError>>;
}
