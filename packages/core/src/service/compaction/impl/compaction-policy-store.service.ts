/**
 * Default {@link CompactionPolicyStore} backed by internal KKV.
 *
 * @module service/compaction/impl/compaction-policy-store.service
 */

import { compactionPolicyFromJson, compactionPolicyToJson } from "@/domain/compaction/compaction-policy-from-json.js";
import type { CompactionPolicy } from "@/domain/compaction/compaction-policy.js";
import { CompactionPolicyError } from "@/errors/compaction-policy-errors.js";
import { KkvError } from "@/errors/kkv-errors.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { CompactionPolicyStore } from "../compaction-policy-store.port.js";

/** KKV module for global compaction policy (not agent definitions). */
const MODULE = "nm-compaction";
const KEY_POLICY = "policy";

export class DefaultCompactionPolicyStore implements CompactionPolicyStore {
  constructor(private readonly kkv: KkvService) {}

  async getPolicy(): Promise<CompactionPolicy | null> {
    const raw = await this.getRaw();
    if (raw === undefined) {
      return null;
    }
    try {
      return compactionPolicyFromJson(JSON.parse(raw) as unknown);
    } catch (error) {
      if (error instanceof CompactionPolicyError) {
        throw error;
      }
      throw new CompactionPolicyError(
        "INVALID_SCHEMA",
        error instanceof Error ? error.message : "invalid policy JSON",
      );
    }
  }

  async setPolicy(policy: CompactionPolicy): Promise<void> {
    const json = JSON.stringify(compactionPolicyToJson(policy));
    await this.kkv.set(MODULE, KEY_POLICY, json);
  }

  async clearPolicy(): Promise<void> {
    try {
      await this.kkv.delete(MODULE, KEY_POLICY);
    } catch (error) {
      if (error instanceof KkvError && error.code === "NOT_FOUND") {
        return;
      }
      throw error;
    }
  }

  private async getRaw(): Promise<string | undefined> {
    try {
      return await this.kkv.get(MODULE, KEY_POLICY);
    } catch (error) {
      if (error instanceof KkvError && error.code === "NOT_FOUND") {
        return undefined;
      }
      throw error;
    }
  }
}
