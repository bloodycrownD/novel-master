/**
 * 数据库维护（数据清理）：存储统计、VACUUM 维护链路与两个谓词驱动的
 * 后台搬运任务（存量 blob 形态归一、消息正文压缩搬运）。
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
