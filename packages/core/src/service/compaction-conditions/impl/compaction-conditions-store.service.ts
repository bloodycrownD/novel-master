/**
 * KKV-backed compaction conditions store (`nm-compaction-conditions`).
 *
 * @module service/compaction-conditions/impl/compaction-conditions-store.service
 */

import { decode } from "@/infra/serialization/decode.js";
import { compactionConditionsSchema } from "@/domain/compaction-conditions/model/compaction-conditions.schema.js";
import {
  DEFAULT_HIDE_START_DEPTH,
  type CompactionConditions,
} from "@/domain/compaction-conditions/model/compaction-conditions.js";
import { ConfigDecodeError } from "@/errors/config-decode-errors.js";
import { compactionConditionsInvalidSchema } from "@/errors/compaction-conditions-errors.js";
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

function isV3Document(raw: unknown): raw is Record<string, unknown> {
  if (raw == null || typeof raw !== "object") {
    return false;
  }
  const doc = raw as Record<string, unknown>;
  return doc.schemaVersion === 3;
}

function migrateV2ToV3(raw: Record<string, unknown>): Record<string, unknown> {
  const visibleFloor =
    typeof raw.visibleFloor === "number"
      ? raw.visibleFloor
      : typeof raw["visible-floor"] === "number"
      ? (raw["visible-floor"] as number)
      : undefined;
  return {
    schemaVersion: 3,
    enabled: Boolean(raw.enabled),
    tokenRatio: typeof raw.tokenRatio === "number" ? raw.tokenRatio : 0.8,
    ...(visibleFloor != null ? { visibleFloor } : {}),
  };
}

/**
 * v3 → v4 迁移：补 `hideStartDepth` 默认值（与历史事件配置默认值一致）。
 *
 * 返回的是「待 decode 的 v4 wire 原型」，字段约束交给 {@link compactionConditionsSchema} 兜底。
 */
function migrateV3ToV4(raw: Record<string, unknown>): Record<string, unknown> {
  const visibleFloor =
    typeof raw.visibleFloor === "number"
      ? raw.visibleFloor
      : typeof raw["visible-floor"] === "number"
      ? (raw["visible-floor"] as number)
      : undefined;
  const tokenRatio =
    typeof raw.tokenRatio === "number" ? raw.tokenRatio : undefined;
  return {
    schemaVersion: 4,
    enabled: Boolean(raw.enabled),
    ...(tokenRatio != null ? { tokenRatio } : {}),
    ...(visibleFloor != null ? { visibleFloor } : {}),
    hideStartDepth: DEFAULT_HIDE_START_DEPTH,
  };
}

function rethrowDecodeError(error: unknown): never {
  if (error instanceof ConfigDecodeError && error.code === "INVALID_SCHEMA") {
    throw compactionConditionsInvalidSchema(error.message);
  }
  throw error;
}

export class DefaultCompactionConditionsStore
  implements CompactionConditionsStore
{
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
        `invalid JSON in nm-compaction-conditions/policy: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    if (isV2Document(parsed)) {
      // v2 → v3 → v4 两步迁移：先升到 v3 形态，再补 hideStartDepth 升 v4。
      const v4 = migrateV3ToV4(migrateV2ToV3(parsed));
      let validatedFromV2: CompactionConditions;
      try {
        validatedFromV2 = decode(v4, compactionConditionsSchema);
      } catch (error) {
        rethrowDecodeError(error);
      }
      await this.kkv.set(MODULE, KEY_POLICY, JSON.stringify(validatedFromV2));
      return validatedFromV2;
    }
    if (isV3Document(parsed)) {
      const migrated = migrateV3ToV4(parsed);
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
