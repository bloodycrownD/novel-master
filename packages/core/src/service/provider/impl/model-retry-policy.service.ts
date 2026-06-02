/**
 * Default {@link ModelRetryPolicyService} backed by internal KKV.
 *
 * KKV key: `policy`
 *
 * @module service/provider/impl/model-retry-policy.service
 */

import { KkvError } from "@/errors/kkv-errors.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type {
  ModelRetryPolicy,
  ModelRetryPolicyService,
} from "../model-retry-policy.port.js";

/** KKV module for global model retry policy (provider transient failures). */
const MODULE = "nm-model-retry";
const KEY = "policy";

function assertValidPolicy(input: ModelRetryPolicy): void {
  const bad = (msg: string) => {
    throw new Error(`Invalid retry policy: ${msg}`);
  };
  if (!Number.isFinite(input.maxRetries) || input.maxRetries < 0) {
    bad("maxRetries must be >= 0");
  }
  if (!Number.isFinite(input.baseDelayMs) || input.baseDelayMs < 0) {
    bad("baseDelayMs must be >= 0");
  }
  if (!Number.isFinite(input.maxDelayMs) || input.maxDelayMs < 0) {
    bad("maxDelayMs must be >= 0");
  }
  if (input.maxDelayMs < input.baseDelayMs) {
    bad("maxDelayMs must be >= baseDelayMs");
  }
  if (!Number.isFinite(input.jitterRatio) || input.jitterRatio < 0 || input.jitterRatio > 1) {
    bad("jitterRatio must be in [0, 1]");
  }
}

function parsePolicyJson(raw: string): ModelRetryPolicy {
  const parsed = JSON.parse(raw) as Partial<ModelRetryPolicy>;
  const policy: ModelRetryPolicy = {
    maxRetries: Number(parsed.maxRetries),
    baseDelayMs: Number(parsed.baseDelayMs),
    maxDelayMs: Number(parsed.maxDelayMs),
    jitterRatio: Number(parsed.jitterRatio),
  };
  assertValidPolicy(policy);
  return policy;
}

/** Persists retry policy in novel.db KKV. */
export class DefaultModelRetryPolicyService implements ModelRetryPolicyService {
  constructor(private readonly kkv: KkvService) {}

  async getPolicy(): Promise<ModelRetryPolicy | null> {
    let raw: string;
    try {
      raw = await this.kkv.get(MODULE, KEY);
    } catch (error) {
      if (error instanceof KkvError && error.code === "NOT_FOUND") {
        return null;
      }
      throw error;
    }
    try {
      return parsePolicyJson(raw);
    } catch {
      // Treat invalid stored values as "unset" to avoid bricking requests.
      return null;
    }
  }

  async setPolicy(policy: ModelRetryPolicy): Promise<void> {
    assertValidPolicy(policy);
    // WHY: serialized config must be stable across runtimes (CLI/mobile); JSON is the boundary.
    await this.kkv.set(MODULE, KEY, JSON.stringify(policy));
  }

  async clearPolicy(): Promise<void> {
    try {
      await this.kkv.delete(MODULE, KEY);
    } catch (error) {
      if (error instanceof KkvError && error.code === "NOT_FOUND") {
        return;
      }
      throw error;
    }
  }
}

