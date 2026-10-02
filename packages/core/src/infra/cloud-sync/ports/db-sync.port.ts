/**
 * 数据库同步端口：快照导出/导入与 Agent 活跃守卫。
 *
 * @module infra/cloud-sync/ports/db-sync.port
 */

/**
 * 整库备份导出/导入抽象；导出产物须经 scrub 后上传。
 *
 * 导入两条路径的返回类型放宽为 `{ databaseReplaced: boolean } | void`：
 * `void` 兼容既有 mock 与手写测试桩。**默认口径（写死，调用点按此处理）**：
 * `databaseReplaced == null` 一律按 `false` 处理（保守：不重建 runtime）。
 *
 * 实现方在「活动库文件被替换」时必须让信号送达调用方：
 * 成功路径靠返回值；「覆盖已成功、后续收尾失败」的抛错路径靠
 * `DatabaseReplacedError` 这类异常类型承载（函数抛错时返回值送不到调用方）。
 */
export interface DbSyncPort {
  isAgentActive(): boolean;
  exportSnapshotToPath(destPath: string): Promise<void>;
  importSnapshot(
    bytes: Uint8Array
  ): Promise<{ databaseReplaced: boolean } | void>;
  /** 从本地快照文件导入（可选；协调器在 Pull 时优先于内存路径） */
  importSnapshotFromPath?(
    path: string
  ): Promise<{ databaseReplaced: boolean } | void>;
}
