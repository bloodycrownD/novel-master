/**
 * Desktop 数据库维护（数据清理）服务：存储统计 + 执行清理维护链路。
 *
 * @module services/db-maintenance
 */
import { stat } from "node:fs/promises";
import { createDbMaintenanceService } from "@novel-master/core";
import { getDesktopRuntime } from "../runtime/desktop-runtime-singleton.js";
import { resolveDbPath } from "../runtime/resolve-db-path.js";
import { isDesktopAgentActive } from "../runtime/agent-activity.js";
import { isDesktopCloudSyncBusy } from "./cloud-sync.service.js";
import { setDesktopDbMaintenanceBusy } from "./db-maintenance-busy.js";

export {
  isDesktopDbMaintenanceBusy,
  resetDesktopDbMaintenanceBusyForTest,
} from "./db-maintenance-busy.js";

/** 采样存储统计：库文件体积（main 侧 stat）+ freelist 可回收量（core PRAGMA）。 */
export async function getDbMaintenanceStats(): Promise<{
  fileBytes: number;
  reclaimableBytes: number;
}> {
  // 先确保 runtime/库文件就绪再 stat：并行赛跑会在冷启动（库尚未
  // bootstrap 落盘）时拿到 ENOENT。
  const runtime = await getDesktopRuntime();
  const fileInfo = await stat(resolveDbPath());
  const storage = await createDbMaintenanceService(
    runtime.conn,
  ).getStorageStats();
  return {
    fileBytes: fileInfo.size,
    reclaimableBytes: storage.reclaimableBytes,
  };
}

/**
 * 执行数据清理：stat 前体积 → core 维护链路（缓存 GC → checkpoint →
 * VACUUM）→ stat 后体积。
 *
 * better-sqlite3 的 VACUUM 是同步执行，期间 main 事件循环冻结——所以
 * busy 必须在进入本函数后立刻置位（renderer 侧也不得不前置 busy，不
 * 能依赖 main 推送），并用 try/finally 保证任何失败路径都复位。
 */
export async function runDbMaintenance(): Promise<{
  beforeBytes: number;
  afterBytes: number;
}> {
  if (isDesktopAgentActive()) {
    throw new Error("Agent 运行中，请稍后再操作");
  }
  if (isDesktopCloudSyncBusy()) {
    throw new Error("云同步进行中，请稍后再操作");
  }
  setDesktopDbMaintenanceBusy(true);
  try {
    const dbPath = resolveDbPath();
    const beforeInfo = await stat(dbPath);
    const runtime = await getDesktopRuntime();
    await createDbMaintenanceService(runtime.conn).runDatabaseMaintenance();
    const afterInfo = await stat(dbPath);
    return {
      beforeBytes: beforeInfo.size,
      afterBytes: afterInfo.size,
    };
  } finally {
    setDesktopDbMaintenanceBusy(false);
  }
}
