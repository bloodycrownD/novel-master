/**
 * ZIP 归档的字节级守卫：PK 魔数，可选 EOCD 完整性。
 *
 * 两端选择不同深度是**既定行为**，不是漂移，收成同一函数的两个 `depth` 值：
 * - `"magic"`：只认前 4 字节（desktop 的挑选/导出路径用；读到的是整文件，
 *   截断由后续 `parseVfsZip` 的中央目录解析兜底）。
 * - `"complete"`：魔数 + 尾部回扫 EOCD（mobile 的挑选路径用；picker 拷入的
 *   副本可能被截断，需要在交给导入事务之前拦下）。
 *
 * @module domain/vfs/logic/vfs-zip-archive
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

/** EOCD（`PK\x05\x06`）签名；中央目录解析侧同名常量未导出，这里单独持有。 */
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_BYTES = 22;
/** EOCD 注释最长 0xffff 字节，回扫窗口 = 22 + 注释上限。 */
const EOCD_MAX_COMMENT_BYTES = 0xffff;

/** 校验深度：`"magic"` 只验魔数，`"complete"` 额外要求 EOCD 存在。 */
export type ZipArchiveCheckDepth = "magic" | "complete";

/**
 * 校验 ZIP 归档字节。
 *
 * `"magic"` 认 `PK\x03\x04`（本地文件头）/ `PK\x05\x06`（空归档）/
 * `PK\x07\x08`（spanned）；`"complete"` 在其上自文件尾向前回扫 EOCD
 * （`PK\x05\x06`），用于发现截断或损坏的归档。
 */
export function assertZipArchive(bytes: Uint8Array, depth: ZipArchiveCheckDepth): Result<void, AppError<"VFS_ZIP_INVALID_ARCHIVE">> {
  const hasMagic = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) && (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
  if (!hasMagic) {
    return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", { detail: `not a ZIP archive (${bytes.length} bytes)` }));
  }
  if (depth === "magic") {
    return Result.ok(undefined);
  }
  const searchStart = Math.max(0, bytes.length - (EOCD_MIN_BYTES + EOCD_MAX_COMMENT_BYTES));
  for (let i = bytes.length - EOCD_MIN_BYTES; i >= searchStart; i--) {
    const sig = (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0;
    if (sig === EOCD_SIGNATURE) {
      return Result.ok(undefined);
    }
  }
  return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", { detail: `ZIP archive incomplete or corrupt (${bytes.length} bytes, missing EOCD)` }));
}
