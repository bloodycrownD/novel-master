/**
 * 数据库维护（数据清理）：存储统计、VACUUM 维护链路与两个谓词驱动的
 * 后台搬运任务（存量 blob 形态归一、存量消息正文解压回明文）。
 *
 * 适配器注册表覆盖三张表（vfs_content_blob / session_file_cache_blob /
 * chat_message）；解压任务与 blob 归一均从此出口导出。本目录任务并入
 * 主入口 index.ts 是既定出口设计（`./compaction` 子路径名已归属历史
 * 上下文裁剪域，不新增子路径）。
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
/**
 * 消息正文解压搬运（反向任务，message-plaintext 迁移层）：存量压缩行
 * → 明文。KKV 常量从此出口导出（迁移期断言完成标记需要）。
 */
export {
  DEFAULT_DECOMPRESS_SYNC_BUDGET_MS,
  getMessageDecompressStatus,
  LEGACY_MAINTENANCE_PENDING_KKV_KEY,
  LEGACY_MESSAGE_CONTENT_KKV_MODULE,
  MESSAGE_DECOMPRESS_KKV_KEY,
  MESSAGE_DECOMPRESS_KKV_MODULE,
  runMessageContentDecompress,
} from "./impl/message-content-decompression.js";
export type {
  MessageDecompressRunResult,
  MessageDecompressStatus,
  RunMessageContentDecompressOptions,
} from "./impl/message-content-decompression.js";
/**
 * 消息引用化回迁（v1.5.30 unref 回退的反向搬运）：存量 contentRef 行 →
 * `{path, content}` 明文包 + 源 revision 精确 −1。KKV 常量从此出口导出
 * （迁移期断言完成标记需要）。
 */
export {
  DEFAULT_REF_UNREF_SYNC_BUDGET_MS,
  getMessageRefUnrefStatus,
  MESSAGE_REF_UNREF_KKV_KEY,
  MESSAGE_REF_UNREF_KKV_MODULE,
  runMessageRefUnref,
} from "./impl/message-ref-unref.js";
export type {
  MessageRefUnrefRunResult,
  MessageRefUnrefStatus,
  RunMessageRefUnrefOptions,
} from "./impl/message-ref-unref.js";
