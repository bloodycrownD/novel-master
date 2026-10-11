/**
 * 数据库维护（数据清理）：存储统计与 VACUUM 维护链路，外加启动期维护
 * 欠账的 pending 补跑公共逻辑。
 *
 * 两个谓词驱动的后台搬运任务——存量 blob 形态归一（`nm-blob-binary`）与
 * VFS 非 head 历史版本混合打包（`nm-vfs-pack`）——已随第七轮退役（v1.5.41
 * 同批：真实库前置确认门均已过，两表 content_hash 全为 64 位 hex 明文键、
 * 打包零候选水位已置且零失败）。pack 两表与其读路径编码
 * （`domain/vfs/content-store/logic/pack-codec.ts`）是现行数据形态，继续保留。
 *
 * @module infra/db-maintenance
 */

export {
  createDbMaintenanceService,
  runStartupMaintenanceOnce,
} from "./impl/db-maintenance.service.js";
export type {
  DatabaseMaintenanceResult,
  DbMaintenanceService,
  StorageStats,
} from "./db-maintenance.port.js";
