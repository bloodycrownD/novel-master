/**
 * Compaction conditions KKV store port.
 *
 * @module service/compaction-conditions/compaction-conditions-store.port
 */

import type { CompactionConditions } from "@/domain/compaction-conditions/model/compaction-conditions.js";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

export interface CompactionConditionsStore {
  /** 读失败走 `Result.err(AppError)`（`KKV_NOT_FOUND` 归一为 `null`）；存量数据 schema 违约仍 throw（impl parseAndDecode）。 */
  getConditions(): Promise<Result<CompactionConditions | null, AppError>>;
  setConditions(conditions: CompactionConditions): Promise<void>;
  clearConditions(): Promise<void>;
}
