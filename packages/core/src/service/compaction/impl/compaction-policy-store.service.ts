/**
 * Default {@link CompactionPolicyStore} backed by internal KKV.
 *
 * @module service/compaction/impl/compaction-policy-store.service
 */

import { decode } from "@/infra/serialization/decode.js";
import { encode } from "@/infra/serialization/encode.js";
import { compactionPolicySchema } from "@/domain/compaction/compaction-policy.schema.js";
import type { CompactionPolicy } from "@/domain/compaction/compaction-policy.js";
import { CompactionPolicyError } from "@/errors/compaction-policy-errors.js";
import { ConfigDecodeError } from "@/errors/config-decode-errors.js";
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
      return decode(JSON.parse(raw) as unknown, compactionPolicySchema);
    } catch (error) {
      if (
        error instanceof CompactionPolicyError ||
        error instanceof ConfigDecodeError
      ) {
        throw new CompactionPolicyError("INVALID_SCHEMA", error.message);
      }
      throw new CompactionPolicyError(
        "INVALID_SCHEMA",
        error instanceof Error ? error.message : "invalid policy JSON",
      );
    }
  }

  async setPolicy(policy: CompactionPolicy): Promise<void> {
    const wire = encode(policy, compactionPolicySchema);
    const json = JSON.stringify(wire);
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
