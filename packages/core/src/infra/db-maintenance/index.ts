/**
 * 数据库维护（数据清理）：存储统计与 VACUUM 维护链路。
 *
 * @module infra/db-maintenance
 */

export { createDbMaintenanceService } from "./impl/db-maintenance.service.js";
export type {
  DatabaseMaintenanceResult,
  DbMaintenanceService,
  StorageStats,
} from "./db-maintenance.port.js";
