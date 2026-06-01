/**
 * KKV-backed compaction conditions store (`nm-compaction-conditions`).
 *
 * @module service/compaction-conditions/impl/compaction-conditions-store.service
 */

import { decode } from "@/infra/serialization/decode.js";
import { encode } from "@/infra/serialization/encode.js";
import { compactionConditionsSchema } from "@/domain/compaction-conditions/model/compaction-conditions.schema.js";
import type { CompactionConditions } from "@/domain/compaction-conditions/model/compaction-conditions.js";
import { KkvError } from "@/errors/kkv-errors.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { CompactionConditionsStore } from "../compaction-conditions-store.port.js";

const MODULE = "nm-compaction-conditions";
const KEY_POLICY = "policy";

export class DefaultCompactionConditionsStore implements CompactionConditionsStore {
  constructor(private readonly kkv: KkvService) {}

  async getConditions(): Promise<CompactionConditions | null> {
    const raw = await this.getRaw();
    if (raw === undefined) {
      return null;
    }
    try {
      return decode(JSON.parse(raw) as unknown, compactionConditionsSchema);
    } catch {
      return null;
    }
  }

  async setConditions(conditions: CompactionConditions): Promise<void> {
    const wire = encode(conditions, compactionConditionsSchema);
    await this.kkv.set(MODULE, KEY_POLICY, JSON.stringify(wire));
  }

  async clearConditions(): Promise<void> {
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
