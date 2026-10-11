/**
 * 数据库维护（数据清理）服务：存储统计 + 缓存 GC/checkpoint/VACUUM 维护链路，
 * 外加启动期维护欠账的 pending 补跑公共逻辑。
 *
 * 各端后台搬运任务已全部退役（消息正文解压/引用化回迁随 v1.5.40，blob 形态
 * 归一与 VFS 历史版本打包随 v1.5.41 第七轮）；pending 补跑（module/key
 * 参数化）作为通用件保留，供后续启动期后台任务复用——历史库残留的失败兜底
 * 标记已无消费方（各任务入口均已退役），手动「数据清理」也不再顺带清标记
 * （见 `runDatabaseMaintenance`）。
 *
 * @module infra/db-maintenance/impl/db-maintenance.service
 */

import { SqliteKkvRepository } from "@/domain/kkv/repositories/impl/sqlite-kkv.repository.js";
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

/**
 * 进程级「维护链路已跑过」标记。
 *
 * @remarks 启动期后台任务完成后会触发一次 VACUUM；同一进程内多个任务叠加
 * 时不应反复全库 VACUUM。手动「数据清理」走 {@link
 * DbMaintenanceService.runDatabaseMaintenance}，**不受**本标记约束——用户
 * 显式点击必须永远真执行。
 */
let startupMaintenanceRan = false;

/**
 * 启动期收尾的维护链路（会话级去重版）。
 *
 * 与 {@link DbMaintenanceService.runDatabaseMaintenance} 走同一条链路
 * （缓存 GC → checkpoint → VACUUM），区别只在于**同一进程内只真跑一次**：
 * 首个调用者执行并置标记，其余调用直接短路返回 null。标记在执行前置，
 * 避免并发调用叠加出多次 VACUUM；VACUUM 失败也不回滚标记——失败不影响
 * 正确性（数据已落好，页由后续手动「数据清理」或下次启动归还）。
 *
 * @returns 实际执行的维护结果；已跑过时返回 null（表示本进程跳过）。
 */
export async function runStartupMaintenanceOnce(
  conn: TdbcConnection
): Promise<DatabaseMaintenanceResult | null> {
  if (startupMaintenanceRan) {
    return null;
  }
  startupMaintenanceRan = true;
  return await createDbMaintenanceService(conn).runDatabaseMaintenance();
}

/**
 * 安全执行 app 层维护回调：回调异常只 warn，不得带崩 core 收尾链路。
 *
 * @param logTag 日志前缀（`[message-content-decompress]` 之类），让告警可
 *   溯源到具体任务。
 */
export function callMaintenanceHook(
  hook: (() => void) | undefined,
  label: string,
  logTag: string
): void {
  if (hook == null) {
    return;
  }
  try {
    hook();
  } catch (error) {
    console.warn(
      `[${logTag}] ${label} 回调抛错，已忽略：${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/** {@link runPendingStartupMaintenance} 入参（module/key 参数化，各后台任务共用）。 */
export interface PendingStartupMaintenanceArgs {
  /** pending 标记所在的 KKV module。 */
  readonly kkvModule: string;
  /** pending 标记的 key（`startupMaintenancePending`）。 */
  readonly pendingKey: string;
  /** 任务日志标签（告警溯源用）。 */
  readonly logTag: string;
  /** 进入维护段前的回调（app 层置 busy 信号用）。 */
  readonly beforeMaintenance?: () => void;
  /** 维护段结束后的回调（finally 语义复位 busy 信号用）。 */
  readonly afterMaintenance?: () => void;
}

/**
 * 入口的 pending 补跑（历史库维护欠账的一次性清偿）。
 *
 * 库里存有 `startupMaintenancePending` 标记 = 上次收尾维护链路失败过
 * （页空间尚未回收）。此时无视「本轮无进展」——包括完成标记已置位的
 * 稳态短路路径——强制补跑一次维护；清标记以 {@link
 * runStartupMaintenanceOnce} 返回非 null 为条件（本进程真跑了维护且
 * 未抛错）。返回 null 说明本进程已跑过维护（进程级去重短路），无法
 * 确认那次成功与否，保守保留标记待下次冷启动补跑——这是正常场景
 * （多补一次 VACUUM 无害，漏补则页空间永不回收），warn 说明即可。
 *
 * 必须用去重版而非手动 `runDatabaseMaintenance`：后者不受进程级去重
 * 约束，多任务叠加时会把全库 VACUUM 跑成多次（大库的同步阻塞翻倍，正是
 * ic-01 要收口的事故形态）。
 */
export async function runPendingStartupMaintenance(
  conn: TdbcConnection,
  args: PendingStartupMaintenanceArgs
): Promise<void> {
  const kkv = new SqliteKkvRepository(conn);
  const entry = await kkv.get(args.kkvModule, args.pendingKey);
  if (entry == null) {
    return;
  }
  callMaintenanceHook(args.beforeMaintenance, "beforeMaintenance", args.logTag);
  try {
    const result = await runStartupMaintenanceOnce(conn);
    if (result !== null) {
      try {
        await kkv.delete(args.kkvModule, args.pendingKey);
      } catch (error) {
        console.warn(
          `[${args.logTag}] 清除 ${args.pendingKey} 标记失败（下次启动会多补跑一次维护，无害）：${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    } else {
      console.warn(
        `[${args.logTag}] ${args.pendingKey} 补跑被进程级去重短路（本进程已跑过维护链路），保留标记待下次冷启动补跑——正常场景`
      );
    }
  } catch (error) {
    console.warn(
      `[${args.logTag}] ${args.pendingKey} 补跑维护链路失败，保留标记待下次启动重试：${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    callMaintenanceHook(args.afterMaintenance, "afterMaintenance", args.logTag);
  }
}
