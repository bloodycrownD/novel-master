/**
 * SQLite 备份文件的头 16 字节校验（魔数）。
 *
 * 两端导入前都要「先认文件是不是 SQLite 备份再动库」：desktop 在 FromPath 读
 * 头 16 字节、mobile 在 FromBytes 校验内存字节，两份实现与文案逐字相同。
 * ⚠️ mobile 的 FromPath **不做**魔数校验（只查存在性 + 体积），这是既有口径，
 * 不在本函数收敛范围内——别为了「一致」把它接上去，那会改变失败分支。
 *
 * @module infra/db-backup/sqlite-backup-header
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

const SQLITE_MAGIC = "SQLite format 3";
const SQLITE_HEADER_BYTES = 16;

/**
 * SQLite 备份魔数校验。
 */
export const SqliteBackupHeader = {
  /**
   * 校验字节流开头的 SQLite 魔数。
   *
   * @param bytes 备份文件的前 16 字节（可短于 16，短则报「文件过小」）
   */
  assert(bytes: Uint8Array): Result<void, AppError<"INFRA_VALIDATION_FAILED">> {
    if (bytes.length < SQLITE_HEADER_BYTES) {
      return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: "文件过小，不是有效的数据库备份" }));
    }
    const header = String.fromCharCode(...bytes.subarray(0, SQLITE_HEADER_BYTES));
    if (!header.startsWith(SQLITE_MAGIC)) {
      return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: "不是有效的 SQLite 数据库备份" }));
    }
    return Result.ok(undefined);
  },
} as const;
