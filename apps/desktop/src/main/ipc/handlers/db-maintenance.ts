/**
 * Database maintenance IPC — 存储统计与数据清理（GC + checkpoint + VACUUM）。
 */
import type {
  DbMaintenanceResult,
  DbStatsResult,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import {
  getDbMaintenanceStats,
  runDbMaintenance,
} from "../../services/db-maintenance.service.js";
import { formatIpcError } from "../ipc-error.js";

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

export async function handleDbMaintenance(): Promise<
  IpcResult<DbMaintenanceResult>
> {
  try {
    const result = await runDbMaintenance();
    if (!result.ok) return { ok: false, error: formatIpcError(result.error) };
    return { ok: true, data: result.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
