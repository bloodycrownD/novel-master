/**
 * Compaction conditions 错误工厂：统一返回 `AppError`。
 *
 * @module errors/compaction-conditions-errors
 */

import { AppError } from "./app-error.js";

/** 存储的压缩条件 wire 文档不符合 schema。 */
export function compactionConditionsInvalidSchema(message: string, details?: Record<string, unknown>): AppError<"COMPACTION_CONDITIONS_INVALID_SCHEMA"> {
  return new AppError("COMPACTION_CONDITIONS_INVALID_SCHEMA", message, details);
}
