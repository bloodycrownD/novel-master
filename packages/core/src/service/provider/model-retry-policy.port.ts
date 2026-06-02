/**
 * Model retry policy storage port.
 *
 * @module service/provider/model-retry-policy.port
 */

export interface ModelRetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}

export interface ModelRetryPolicyService {
  /**
   * Returns current retry policy, or null when unset (caller uses defaults).
   */
  getPolicy(): Promise<ModelRetryPolicy | null>;

  /**
   * Persists retry policy. Validation lives in the service impl.
   */
  setPolicy(policy: ModelRetryPolicy): Promise<void>;

  /**
   * Clears persisted policy (falls back to defaults).
   */
  clearPolicy(): Promise<void>;
}

