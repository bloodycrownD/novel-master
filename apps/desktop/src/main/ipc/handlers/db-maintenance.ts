/**
 * Database maintenance IPC — 存储统计与数据清理（GC + checkpoint + VACUUM）。
 *
 * 取消（signal-abort-scope §五）：db-maintenance 不设 timeout，只提供手动取消；
 * `VACUUM / checkpoint` 是 better-sqlite3 同步段，标为**不可中断窗口**——中止
 * 只能落在入口检查点，窗口内点击取消按自然终态 settle（T-S15 例外条款）。
 */
import { ABORT_KEY, type AbortScope } from "@novel-master/core/abort";
import type { Outcome } from "@novel-master/core/errors";
import type { DbMaintenanceResult, DbStatsResult, IpcResult } from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { getDbMaintenanceStats, runDbMaintenance } from "../../services/db-maintenance.service.js";
import { formatIpcError } from "../ipc-error.js";
import { ipcErr } from "../ipc-result.js";
import { runAbortable, runKey } from "../run-scope.js";

/** 可选请求体：runId 只在会展示取消按钮的调用方生成。 */
export type DbMaintenanceRunRequest = { readonly runId?: string };

export async function handleDbStats(): Promise<IpcResult<DbStatsResult>> {
  try {
    const stats = await getDbMaintenanceStats();
    // 装配的已知失败沿 Result 到达（错误通道迁移七期），就地转码。
    if (!stats.ok) return { ok: false, error: formatIpcError(stats.error) };
    return { ok: true, data: stats.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleDbMaintenance(req?: DbMaintenanceRunRequest): Promise<IpcResult<DbMaintenanceResult>> {
  const built = await getDesktopRuntime();
  if (!built.ok) return ipcErr(formatIpcError(built.error));
  const rt = built.value;
  return runAbortable({ registry: rt.abortRegistry, key: runKey(ABORT_KEY.dbMaintenance, req?.runId) }, (scope) => doDbMaintenance(scope));
}

/**
 * 维护段：入口检查点由 `runDbMaintenance` 在**三重互斥守卫之后**执行（策略表），
 * 之后进入不可中断窗口（VACUUM / checkpoint 同步段无法中途让出）。
 * 命中的中断由 service 直接返回 `Outcome`，本层原样交给 `runAbortable` 边界转码。
 */
export async function doDbMaintenance(scope: AbortScope): Promise<Outcome<DbMaintenanceResult>> {
  return runDbMaintenance({ checkpoint: () => scope.checkpoint() });
}
