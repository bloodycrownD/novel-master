/**
 * 数据库维护（数据清理）：存储统计、VACUUM 维护链路与三个谓词驱动的
 * 后台搬运任务（存量 blob 形态归一、消息正文压缩搬运、VFS 非 head
 * 历史版本混合打包）。
 *
 * 适配器注册表覆盖三张表（vfs_content_blob / session_file_cache_blob /
 * chat_message）；压缩任务、blob 归一与 VFS 打包（含应急校验/反向展开
 * 工具）均从此出口导出。本目录任务并入主入口 index.ts 是既定出口设计
 * （`./compaction` 子路径名已归属历史上下文裁剪域，不新增子路径）。
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
  DEFAULT_COMPACTION_SYNC_BUDGET_MS,
  MESSAGE_COMPACTION_KKV_KEY,
  MESSAGE_COMPACTION_KKV_MODULE,
  getMessageCompactionStatus,
  runMessageContentCompaction,
} from "./impl/message-content-compaction.js";
export type {
  MessageCompactionRunResult,
  MessageCompactionStatus,
  RunMessageContentCompactionOptions,
} from "./impl/message-content-compaction.js";
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
