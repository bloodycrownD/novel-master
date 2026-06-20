/**
 * KKV-backed compaction conditions store (`nm-compaction-conditions`).
 *
 * @module service/compaction-conditions/impl/compaction-conditions-store.service
 */

import { decode } from "@/infra/serialization/decode.js";
import { compactionConditionsSchema } from "@/domain/compaction-conditions/model/compaction-conditions.schema.js";
import type { CompactionConditions } from "@/domain/compaction-conditions/model/compaction-conditions.js";
import { ConfigDecodeError } from "@/errors/config-decode-errors.js";
import {
  compactionConditionsInvalidSchema,
} from "@/errors/compaction-conditions-errors.js";
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

function rethrowDecodeError(error: unknown): never {
  if (error instanceof ConfigDecodeError && error.code === "INVALID_SCHEMA") {
    throw compactionConditionsInvalidSchema(error.message);
  }
  throw error;
}

export class DefaultCompactionConditionsStore implements CompactionConditionsStore {
  constructor(private readonly kkv: KkvService) {}

  async getConditions(): Promise<CompactionConditions | null> {
    const raw = await this.getRaw();
    if (raw === undefined) {
      return null;
    }
    return this.parseAndDecode(raw);
  }

  async setConditions(conditions: CompactionConditions): Promise<void> {
    let validated: CompactionConditions;
    try {
      validated = decode(conditions, compactionConditionsSchema);
    } catch (error) {
      rethrowDecodeError(error);
    }
    await this.kkv.set(MODULE, KEY_POLICY, JSON.stringify(validated));
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

  private async parseAndDecode(raw: string): Promise<CompactionConditions> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw compactionConditionsInvalidSchema(
        `invalid JSON in nm-compaction-conditions/policy: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (isV2Document(parsed)) {
      const migrated = migrateV2ToV3(parsed);
      let validated: CompactionConditions;
      try {
        validated = decode(migrated, compactionConditionsSchema);
      } catch (error) {
        rethrowDecodeError(error);
      }
      await this.kkv.set(MODULE, KEY_POLICY, JSON.stringify(validated));
      return validated;
    }
    try {
      return decode(parsed, compactionConditionsSchema);
    } catch (error) {
      rethrowDecodeError(error);
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
