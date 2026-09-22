/**
 * 数据库维护（数据清理）端口类型：存储统计与维护结果。
 *
 * @module infra/db-maintenance/db-maintenance.port
 */

/**
 * SQLite 存储统计单次采样。
 *
 * `pageSize` / `pageCount` / `freelistPages` 分别对应
 * `PRAGMA page_size` / `page_count` / `freelist_count` 的直读值；
 * `reclaimableBytes` = freelistPages × pageSize，即 VACUUM 理论上可
 * 归还给文件系统的字节数（freelist 页全部收缩后的上限口径，实际文件
 * 收缩量以双端 statSync 实测为准）。
 */
export interface StorageStats {
  /** 单页字节数（PRAGMA page_size）。 */
  readonly pageSize: number;
  /** 总页数（PRAGMA page_count）。 */
  readonly pageCount: number;
  /** freelist 空闲页数（PRAGMA freelist_count）。 */
  readonly freelistPages: number;
  /** freelist 可回收字节（freelistPages × pageSize）。 */
  readonly reclaimableBytes: number;
}

/**
 * `runDatabaseMaintenance` 的结果。
 *
 * 回收量口径：`before` 在维护链路的缓存 GC **之后**、checkpoint/VACUUM
 * 之前采样（GC 删除孤儿 blob 行释放的页此时已挂 freelist），`after` 在
 * VACUUM 完成后采样（freelist 已归零）——因此 `reclaimedBytes` 涵盖
 * 「存量 freelist + 本次 GC 释放页」两部分，与文件实际收缩量对应。
 */
export interface DatabaseMaintenanceResult {
  /** 缓存 GC 之后、VACUUM 之前的存储统计。 */
  readonly before: StorageStats;
  /** VACUUM 完成后的存储统计（freelistPages 应为 0）。 */
  readonly after: StorageStats;
  /** before.reclaimableBytes - after.reclaimableBytes（下限 0 防御）。 */
  readonly reclaimedBytes: number;
}

/** 数据库维护服务：存储统计 + 数据清理维护链路。 */
export interface DbMaintenanceService {
  /** 采样当前存储统计（只读 PRAGMA，无副作用）。 */
  getStorageStats(): Promise<StorageStats>;
  /**
   * 执行数据清理维护链路：缓存 GC → 防御性 WAL checkpoint → VACUUM。
   *
   * 必须在**事务外**调用（SQLite 原生拒绝事务内 VACUUM，事务中调用会
   * 得到错误而非静默）；并发安全由 tdbc 驱动层的连接级互斥串行保证。
   */
  runDatabaseMaintenance(): Promise<DatabaseMaintenanceResult>;
}
