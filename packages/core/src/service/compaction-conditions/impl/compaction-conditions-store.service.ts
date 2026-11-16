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
import { AppError, isAppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
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

/** decode 失败转码：CONFIG_DECODE_INVALID_SCHEMA → 本域码。schema 违约仍 throw（见 port 注），不落 Result 通道。 */
function rethrowDecodeError(error: AppError): never {
  throw new AppError("COMPACTION_CONDITIONS_INVALID_SCHEMA", { detail: error.message });
}

export class DefaultCompactionConditionsStore
  implements CompactionConditionsStore
{
  constructor(private readonly kkv: KkvService) {}

  async getConditions(): Promise<Result<CompactionConditions | null, AppError>> {
    const raw = await this.kkv.get(MODULE, KEY_POLICY);
    if (!raw.ok && !isAppError(raw.error, "KKV_NOT_FOUND")) return Result.err(raw.error);
    if (!raw.ok) return Result.ok(null);
    return Result.ok(await this.parseAndDecode(raw.value));
  }

  async setConditions(conditions: CompactionConditions): Promise<void> {
    const validated = decode(conditions, compactionConditionsSchema);
    if (!validated.ok) rethrowDecodeError(validated.error);
    await this.kkv.set(MODULE, KEY_POLICY, JSON.stringify(validated.value));
  }

  async clearConditions(): Promise<void> {
    try {
      await this.kkv.delete(MODULE, KEY_POLICY);
    } catch (error) {
      if (isAppError(error, "KKV_NOT_FOUND")) {
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
      throw new AppError("COMPACTION_CONDITIONS_INVALID_SCHEMA", { detail: `invalid JSON in nm-compaction-conditions/policy: ${error instanceof Error ? error.message : String(error)}` });
    }
    if (isV2Document(parsed)) {
      // v2 → v3 → v4 两步迁移：先升到 v3 形态，再补 hideStartDepth 升 v4。
      const v4 = migrateV3ToV4(migrateV2ToV3(parsed));
      const validatedFromV2 = decode(v4, compactionConditionsSchema);
      if (!validatedFromV2.ok) rethrowDecodeError(validatedFromV2.error);
      await this.kkv.set(MODULE, KEY_POLICY, JSON.stringify(validatedFromV2.value));
      return validatedFromV2.value;
    }
    if (isV3Document(parsed)) {
      const migrated = migrateV3ToV4(parsed);
      const validated = decode(migrated, compactionConditionsSchema);
      if (!validated.ok) rethrowDecodeError(validated.error);
      await this.kkv.set(MODULE, KEY_POLICY, JSON.stringify(validated.value));
      return validated.value;
    }
    const direct = decode(parsed, compactionConditionsSchema);
    if (!direct.ok) rethrowDecodeError(direct.error);
    return direct.value;
  }
}
