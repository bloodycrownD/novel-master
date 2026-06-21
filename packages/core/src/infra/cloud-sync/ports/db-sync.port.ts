/**
 * 数据库同步端口：快照导出/导入与 Agent 活跃守卫。
 *
 * @module infra/cloud-sync/ports/db-sync.port
 */

/**
 * 整库备份导出/导入抽象；导出产物须经 scrub 后上传。
 */
export interface DbSyncPort {
  isAgentActive(): boolean;
  exportSnapshotToPath(destPath: string): Promise<void>;
  importSnapshot(bytes: Uint8Array): Promise<void>;
  /** 从本地快照文件导入（可选；协调器在 Pull 时优先于内存路径） */
  importSnapshotFromPath?(path: string): Promise<void>;
}
