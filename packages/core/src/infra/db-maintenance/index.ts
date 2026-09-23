/**
 * 数据库维护（数据清理）：存储统计与 VACUUM 维护链路 + 消息正文压缩搬运。
 *
 * @module infra/db-maintenance
 */

export { createDbMaintenanceService } from "./impl/db-maintenance.service.js";
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
