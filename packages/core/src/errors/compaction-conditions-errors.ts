/**
 * Compaction conditions configuration errors.
 *
 * @module errors/compaction-conditions-errors
 */

export type CompactionConditionsErrorCode =
  | "INVALID_SCHEMA"
  | "NOT_FOUND";

export class CompactionConditionsError extends Error {
  readonly code: CompactionConditionsErrorCode;

  constructor(
    code: CompactionConditionsErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CompactionConditionsError";
    this.code = code;
  }
}

/** 存储的压缩条件 wire 文档不符合 schema。 */
export function compactionConditionsInvalidSchema(
  message: string,
  details?: Record<string, unknown>,
): CompactionConditionsError {
  return new CompactionConditionsError("INVALID_SCHEMA", message, details);
}

/** 类型守卫；兼容测试中 src/dist 双实例加载。 */
export function isCompactionConditionsError(
  error: unknown,
  code?: CompactionConditionsErrorCode,
): error is CompactionConditionsError {
  if (!(error instanceof CompactionConditionsError)) {
    if (
      error != null &&
      typeof error === "object" &&
      (error as CompactionConditionsError).name === "CompactionConditionsError"
    ) {
      const c = (error as CompactionConditionsError).code;
      return code == null || c === code;
    }
    return false;
  }
  return code == null || error.code === code;
}
