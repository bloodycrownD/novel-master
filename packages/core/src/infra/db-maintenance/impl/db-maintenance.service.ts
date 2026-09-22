/**
 * 数据库维护（数据清理）服务：存储统计 + 缓存 GC/checkpoint/VACUUM 维护链路。
 *
 * @module infra/db-maintenance/impl/db-maintenance.service
 */

import { runDeferredFileCacheGc } from "@/domain/session-kkv/logic/deferred-file-cache-gc.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type {
  DatabaseMaintenanceResult,
  DbMaintenanceService,
  StorageStats,
} from "../db-maintenance.port.js";

/**
 * 采样当前存储统计。
 *
 * 三条 PRAGMA 均为无参数直读，照 `readSchemaBootVersion` 的
 * query 模式（PRAGMA 不能参数绑定，列为静态字符串无注入面）。
 */
async function readStorageStats(
  conn: TdbcConnection
): Promise<StorageStats> {
  const pageCountRows = await conn.query<{ page_count: number }>(
    "PRAGMA page_count"
  );
  const pageSizeRows = await conn.query<{ page_size: number }>(
    "PRAGMA page_size"
  );
  const freelistRows = await conn.query<{ freelist_count: number }>(
    "PRAGMA freelist_count"
  );
  const pageCount = Number(pageCountRows[0]?.page_count ?? 0);
  const pageSize = Number(pageSizeRows[0]?.page_size ?? 0);
  const freelistPages = Number(freelistRows[0]?.freelist_count ?? 0);
  return {
    pageSize,
    pageCount,
    freelistPages,
    reclaimableBytes: freelistPages * pageSize,
  };
}

/**
 * 创建数据库维护服务。
 *
 * 两个入口共享同一条连接：
 * - `getStorageStats` 只读 PRAGMA，随时可调；
 * - `runDatabaseMaintenance` 顺序执行「缓存 GC → 防御性 checkpoint →
 *   VACUUM」。VACUUM **必须事务外直调 conn**（SQLite 原生拒绝事务内
 *   VACUUM，包 transaction 反而制造误用面），也不得与其它语句组合进
 *   批量执行——每步单独 await，出错即中止并透传错误。
 */
export function createDbMaintenanceService(
  conn: TdbcConnection
): DbMaintenanceService {
  return {
    async getStorageStats(): Promise<StorageStats> {
      return readStorageStats(conn);
    },

    async runDatabaseMaintenance(): Promise<DatabaseMaintenanceResult> {
      // 1. 缓存 GC：回收无 entry 引用行的 session_file_cache_blob。
      //    删除释放的页挂 freelist，因此 before 采样放在 GC 之后，
      //    让 reclaimedBytes 把 GC 的产出也计入（口径见 port 注释）。
      await runDeferredFileCacheGc(conn);

      const before = await readStorageStats(conn);

      // 2. 防御性 WAL checkpoint：WAL 模式下先把 -wal 日志并回主文件再
      //    VACUUM；双端默认 DELETE journal 下为 no-op（照双端
      //    checkpoint*Database 备份先例）。
      await conn.execute("PRAGMA wal_checkpoint(FULL)");

      // 3. VACUUM：重建库文件，把 freelist 页归还文件系统。事务外
      //    直调 conn，不得包 transaction（见函数头注释）。
      await conn.execute("VACUUM");

      const after = await readStorageStats(conn);
      return {
        before,
        after,
        reclaimedBytes: Math.max(
          0,
          before.reclaimableBytes - after.reclaimableBytes
        ),
      };
    },
  };
}
