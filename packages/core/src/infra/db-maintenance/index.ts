/**
 * 数据库维护（数据清理）：存储统计、VACUUM 维护链路与两个谓词驱动的
 * 后台搬运任务（存量 blob 形态归一、VFS 非 head 历史版本混合打包）。
 *
 * 适配器注册表覆盖两张表（vfs_content_blob / session_file_cache_blob）；
 * blob 归一与 VFS 打包（含应急校验/反向展开工具）均从此出口导出。本目录
 * 任务并入主入口 index.ts 是既定出口设计（`./compaction` 子路径名已归属
 * 历史上下文裁剪域，不新增子路径）。
 *
 * 消息正文解压搬运（message-plaintext 反向任务）、blob 归一的 chat_message
 * 适配器与消息引用化回迁（v1.5.30 unref 回退的反向搬运）已随 V1' 与 E1
 * 清理版退役（v1.5.40 同批，前置确认：真实库 content_blob IS NOT NULL /
 * contentRef 谓词均归零，KKV decompressDone / unrefDone 均已置）。
 *
 * @module infra/db-maintenance
 */

export {
  BLOB_BINARY_KKV_MODULE,
  DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS,
  getBlobBinaryStatus,
  runBlobBinaryNormalization,
} from "./impl/blob-binary-normalization.js";
export type {
  BlobBinaryRunResult,
  BlobBinaryStatus,
  BlobBinaryTableId,
  BlobBinaryTableStatus,
  RunBlobBinaryNormalizationOptions,
} from "./impl/blob-binary-normalization.js";
export {
  createDbMaintenanceService,
  runStartupMaintenanceOnce,
} from "./impl/db-maintenance.service.js";
export type {
  DatabaseMaintenanceResult,
  DbMaintenanceService,
  StorageStats,
} from "./db-maintenance.port.js";
export {
  DEFAULT_VFS_PACK_SYNC_BUDGET_MS,
  getVfsContentPackStatus,
  runVfsContentPacking,
  unpackVfsContent,
  verifyVfsContentPacks,
  VFS_PACK_KKV_MODULE,
} from "./impl/vfs-content-packing.js";
export type {
  RunVfsContentPackingOptions,
  VfsContentPackRunResult,
  VfsContentPackStatus,
  VfsContentPackVerifyResult,
  VfsContentUnpackResult,
  VfsPackVerifyFailure,
} from "./impl/vfs-content-packing.js";
