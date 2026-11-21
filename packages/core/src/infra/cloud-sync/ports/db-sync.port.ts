/**
 * 数据库同步端口：快照导出/导入与 Agent 活跃守卫。
 *
 * @module infra/cloud-sync/ports/db-sync.port
 */
import { type AppError } from "@/errors/app-error.js";
import { type Result } from "@/errors/either.js";

/**
 * 整库备份导出/导入抽象；导出产物须经 scrub 后上传。
 *
 * 导入两条路径沿 `Result` 回传：已知失败（非备份文件等校验失败）走
 * `Result.err`，成功值 `{ databaseReplaced }` 指示活动库文件是否已被替换
 * （调用方据此决定是否重建 runtime）。
 *
 * 实现方在「活动库文件被替换」时必须让信号送达调用方：成功路径靠返回值；
 * 「覆盖已成功、后续收尾失败」沿 `DB_SYNC_REPLACE_INCOMPLETE`（Err 通道，details 带
 * providerTablesRestored）——error-matrix-final R2 起全链路纯 Result，调用方判 key。
 */
export interface DbSyncPort {
  isAgentActive(): boolean;
  exportSnapshotToPath(destPath: string): Promise<void>;
  importSnapshot(
    bytes: Uint8Array
  ): Promise<Result<{ databaseReplaced: boolean }, AppError>>;
  /** 从本地快照文件导入（可选；协调器在 Pull 时优先于内存路径） */
  importSnapshotFromPath?(
    path: string
  ): Promise<Result<{ databaseReplaced: boolean }, AppError>>;
}
