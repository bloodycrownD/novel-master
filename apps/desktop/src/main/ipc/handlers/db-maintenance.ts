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
    return { ok: true, data: stats };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleDbMaintenance(): Promise<
  IpcResult<DbMaintenanceResult>
> {
  try {
    const result = await runDbMaintenance();
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
