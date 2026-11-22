/**
 * Compaction conditions KKV store port.
 *
 * @module service/compaction-conditions/compaction-conditions-store.port
 */

import type { CompactionConditions } from "@/domain/compaction-conditions/model/compaction-conditions.js";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

export interface CompactionConditionsStore {
    /** 读失败与存量数据 schema 违约均走 `Result.err(AppError)`（`KKV_NOT_FOUND` 归一为 `null`）。 */
    getConditions(): Promise<Result<CompactionConditions | null, AppError>>;
    /** 端口无失败位、apps set 路径按异常收口：schema 违约在写入口仍 throw。 */
    setConditions(conditions: CompactionConditions): Promise<void>;
    clearConditions(): Promise<void>;
}
