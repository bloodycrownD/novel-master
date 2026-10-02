/**
 * ZIP 体积 / 条数闸的常量与口径（CS-09）。
 *
 * ⚠️ 独立成模块是为了**避免循环依赖**：解析器（`vfs-zip-central-dir.ts` /
 * `vfs-zip-parse.ts`）与校验器（`vfs-zip-validate.ts`）都要用同一组值，而后者
 * 又要 import 解析器。
 *
 * @module domain/vfs/logic/vfs-zip-limits
 */

/** 单个 ZIP 解压后总字节上限。 */
export const VFS_ZIP_MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

/** 单个 ZIP 条目数上限。 */
export const VFS_ZIP_MAX_ENTRY_COUNT = 5_000;

/** 单条 ZIP 条目路径长度上限。 */
export const VFS_ZIP_MAX_ENTRY_PATH_LEN = 512;

/** 解析期闸门口径（可选参数，缺省取上面三个常量）。 */
export interface VfsZipLimits {
  readonly maxUncompressedBytes: number;
  readonly maxEntryCount: number;
}

export const DEFAULT_VFS_ZIP_LIMITS: VfsZipLimits = {
  maxUncompressedBytes: VFS_ZIP_MAX_UNCOMPRESSED_BYTES,
  maxEntryCount: VFS_ZIP_MAX_ENTRY_COUNT,
};
