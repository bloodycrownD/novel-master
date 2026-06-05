/**
 * KKV-backed compaction conditions store (`nm-compaction-conditions`).
 *
 * @module service/compaction-conditions/impl/compaction-conditions-store.service
 */

import { decode } from "@/infra/serialization/decode.js";
import { compactionConditionsSchema } from "@/domain/compaction-conditions/model/compaction-conditions.schema.js";
import type { CompactionConditions } from "@/domain/compaction-conditions/model/compaction-conditions.js";
import { isKkvError } from "@/errors/kkv-errors.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { CompactionConditionsStore } from "../compaction-conditions-store.port.js";

const MODULE = "nm-compaction-conditions";
const KEY_POLICY = "policy";

function isV2Document(raw: unknown): raw is Record<string, unknown> {
  if (raw == null || typeof raw !== "object") {
    return false;
  }
  const doc = raw as Record<string, unknown>;
  return doc.schemaVersion === 2 || doc.tokenThreshold != null;
}

function migrateV2ToV3(raw: Record<string, unknown>): CompactionConditions {
  const visibleFloor =
    typeof raw.visibleFloor === "number"
      ? raw.visibleFloor
      : typeof raw["visible-floor"] === "number"
        ? (raw["visible-floor"] as number)
        : undefined;
  return {
    schemaVersion: 3,
    enabled: Boolean(raw.enabled),
    tokenRatio:
      typeof raw.tokenRatio === "number" ? raw.tokenRatio : 0.8,
    ...(visibleFloor != null ? { visibleFloor } : {}),
  };
}

export class DefaultCompactionConditionsStore implements CompactionConditionsStore {
  constructor(private readonly kkv: KkvService) {}

  async getConditions(): Promise<CompactionConditions | null> {
    const raw = await this.getRaw();
    if (raw === undefined) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isV2Document(parsed)) {
        const migrated = migrateV2ToV3(parsed);
        await this.kkv.set(MODULE, KEY_POLICY, JSON.stringify(migrated));
        return migrated;
      }
      return decode(parsed, compactionConditionsSchema);
    } catch {
      return null;
    }
  }

  async setConditions(conditions: CompactionConditions): Promise<void> {
    // Domain object is already validated; wire schema uses Zod transform (not encodable).
    await this.kkv.set(MODULE, KEY_POLICY, JSON.stringify(conditions));
  }

  async clearConditions(): Promise<void> {
    try {
      await this.kkv.delete(MODULE, KEY_POLICY);
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return;
      }
      throw error;
    }
  }

  private async getRaw(): Promise<string | undefined> {
    try {
      return await this.kkv.get(MODULE, KEY_POLICY);
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return undefined;
      }
      throw error;
    }
  }
}
