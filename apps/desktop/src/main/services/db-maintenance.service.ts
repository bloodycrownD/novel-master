/**
 * Desktop 数据库维护（数据清理）服务：存储统计 + 执行清理维护链路。
 *
 * @module services/db-maintenance
 */
import { stat } from "node:fs/promises";
import { createDbMaintenanceService } from "@novel-master/core";
import { AppError } from "@novel-master/core/errors";
import { Result, type Interrupt, type Outcome } from "@novel-master/core/errors";
import { getDesktopRuntime } from "../runtime/desktop-runtime-singleton.js";
import { resolveDbPath } from "../runtime/resolve-db-path.js";
import { agentActivity } from "../runtime/agent-activity.js";
import { syncBusy } from "./cloud-sync.service.js";
import { maintenanceBusy } from "./db-maintenance-busy.js";

/** 采样存储统计：库文件体积（main 侧 stat）+ freelist 可回收量（core PRAGMA）。 */
export async function getDbMaintenanceStats(): Promise<
  Result<{ fileBytes: number; reclaimableBytes: number }, AppError>
> {
  // 先确保 runtime/库文件就绪再 stat：并行赛跑会在冷启动（库尚未
  // bootstrap 落盘）时拿到 ENOENT。装配的已知失败沿 Result 上行（错误通道迁移七期）。
  const built = await getDesktopRuntime();
  if (!built.ok) return Result.err(built.error);
  const runtime = built.value;
  const fileInfo = await stat(resolveDbPath());
  const maintenance = createDbMaintenanceService(runtime.conn);
  const storage = await maintenance.getStorageStats();
  return Result.ok({
    fileBytes: fileInfo.size,
    reclaimableBytes: storage.reclaimableBytes,
  });
}

/**
 * 执行数据清理：stat 前体积 → core 维护链路（缓存 GC → checkpoint →
 * VACUUM）→ stat 后体积。
 *
 * better-sqlite3 的 VACUUM 是同步执行，期间 main 事件循环冻结——所以
 * busy 必须在进入本函数后立刻置位（renderer 侧也不得不前置 busy，不
 * 能依赖 main 推送），并用 try/finally 保证任何失败路径都复位。
 */
export async function runDbMaintenance(options?: { readonly checkpoint?: () => Interrupt | null }): Promise<
  Outcome<{ beforeBytes: number; afterBytes: number }>
> {
  if (agentActivity.isActive()) {
    return { kind: "failed", error: new AppError("AGENT_BUSY", {detail: "Agent 运行中，请稍后再操作"}) };
  }
  if (syncBusy.isBusy()) {
    return { kind: "failed", error: new AppError("CLI_INVALID_ARGUMENT", { detail: "云同步进行中，请稍后再操作" }) };
  }
  if (maintenanceBusy.isBusy()) {
    return { kind: "failed", error: new AppError("CLI_INVALID_ARGUMENT", { detail: "数据清理进行中，请稍后再操作" }) };
  }
  // 策略表：入口检查点放在三重互斥守卫**之后**——并发冲突必须先报既有
  // busy 错误，而不是被取消语义吞掉；再往后就是 VACUUM / checkpoint 同步段，
  // 不可中断。命中即返回中断 Outcome，由 IPC 边界统一转码。
  const hit = options?.checkpoint?.();
  if (hit != null) return hit;
  maintenanceBusy.set(true);
  try {
    // 与 getDbMaintenanceStats 同口径：先确保 runtime/库文件就绪再 stat，
    // 冷启动（库尚未 bootstrap 落盘）时避免 ENOENT。装配的已知失败沿 Outcome
    // 上行（错误通道迁移十九期），busy 由 finally 复位。
    const built = await getDesktopRuntime();
    if (!built.ok) return { kind: "failed", error: built.error };
    const runtime = built.value;
    const dbPath = resolveDbPath();
    const beforeInfo = await stat(dbPath);
    await createDbMaintenanceService(runtime.conn).runDatabaseMaintenance();
    const afterInfo = await stat(dbPath);
    return {
      kind: "completed",
      value: {
        beforeBytes: beforeInfo.size,
        afterBytes: afterInfo.size,
      },
    };
  } finally {
    maintenanceBusy.set(false);
  }
}
