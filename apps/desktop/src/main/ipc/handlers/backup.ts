/**
 * Database backup IPC — export/import with rebootstrap on import.
 *
 * 取消（signal-abort-scope §五）：`doWork` 返回 `Outcome`，handler 边界按
 * `runAbortable` 的三分派收口。两组策略：
 * - export：原生保存对话框 **resolve 之后**才建 scope 并登记（对话框期间无取消面）；
 *   timeout 300s 只覆盖 copy 段；copyFile 前的检查点在
 *   `db-backup.service` 的「对话框 → 拷贝」原子段内。
 * - import：不设 timeout；仅入口检查点，`close → 覆盖库文件 → restore` 整段
 *   不可中断，**禁止 race 早 settle**（补偿链必须与底层流程同生命周期）。
 *   库已换代时 rebootstrap 无条件执行，成功即按自然终态返回。
 */
import { ABORT_KEY, isAbortLikeError, type AbortScope } from "@novel-master/core/abort";
import type { Outcome } from "@novel-master/core/errors";
import { BrowserWindow } from "electron";
import type { BackupExportResult, BackupImportResult, IpcResult } from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { rebootstrapDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import type { DesktopNovelMasterRuntime } from "../../runtime/types.js";
import { exportDatabaseBackupToPath, importDatabaseBackup, pickDatabaseExportPath } from "../../services/db-backup.service.js";
import { acquireDesktopDbMaintenanceBusy, releaseDesktopDbMaintenanceBusy } from "../../services/db-maintenance-busy.js";
import { formatIpcError } from "../ipc-error.js";
import { ipcErr, ipcOk } from "../ipc-result.js";
import { outcomeIfAborted, runAbortable, runKey } from "../run-scope.js";

/** 可选请求体：runId 只在会展示取消按钮的调用方生成。 */
export type BackupRunRequest = { readonly runId?: string };

export async function handleBackupExport(req?: BackupRunRequest): Promise<IpcResult<BackupExportResult>> {
  const built = await getDesktopRuntime();
  // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
  if (!built.ok) return ipcErr(formatIpcError(built.error));
  const rt = built.value;
  // 策略表：scope（含 300s deadline）在原生保存对话框 resolve 后创建；对话框
  // 期间的 abort 不承诺生效，deadline 也不该消耗在模态窗口上。
  const picked = await pickDatabaseExportPath(BrowserWindow.getFocusedWindow());
  if (!picked.ok) return ipcErr(formatIpcError(picked.error));
  if (picked.value == null) return ipcOk("cancelled");
  const destPath = picked.value;
  return runAbortable({ registry: rt.abortRegistry, key: runKey(ABORT_KEY.backup, req?.runId), timeoutMs: 300_000 }, (scope) => doBackupExport(rt, destPath, scope));
}

/** 可被中断的备份导出段（对话框已 resolve，只剩 copyFile）；检查点命中返回 `Outcome.cancelled`。 */
export async function doBackupExport(rt: DesktopNovelMasterRuntime, destPath: string, scope: AbortScope): Promise<Outcome<BackupExportResult>> {
  const stopped = outcomeIfAborted(scope);
  if (stopped != null) return stopped;
  try {
    await exportDatabaseBackupToPath(rt, destPath, () => scope.checkpoint());
    return { kind: "completed", value: "saved" };
  } catch (err) {
    // copyFile 前 checkpoint 命中：service 抛 AbortError，这里转回控制流 Outcome。
    if (isAbortLikeError(err)) return { kind: "cancelled", reason: scope.reason ?? "user-stop" };
    throw err;
  }
}

export async function handleBackupImport(req?: BackupRunRequest): Promise<IpcResult<BackupImportResult>> {
  // ic-20 外层令牌：busy 为计数/令牌配对——底层 importDatabaseBackupFromBytes
  // 已 acquire/release 自平衡；这里再持一枚，覆盖「库文件已替换、
  // rebootstrap 尚未完成」的重建窗口，release 严格在 rebootstrap 完成之后
  // （finally 兜底失败路径）。计数语义下与底层令牌互不提前清位。
  acquireDesktopDbMaintenanceBusy();
  try {
    const built = await getDesktopRuntime();
    if (!built.ok) return ipcErr(formatIpcError(built.error));
    const rt = built.value;
    return await runAbortable({ registry: rt.abortRegistry, key: runKey(ABORT_KEY.backup, req?.runId) }, (scope) => doBackupImport(scope));
  } finally {
    releaseDesktopDbMaintenanceBusy();
  }
}

/**
 * 备份导入段：`close → 覆盖 → restore` 不可中断，因此**只有入口检查点**，
 * 完成之后不再判取消——库已换代却回 `IPC_ABORTED` 会让用户以为没导入。
 */
export async function doBackupImport(scope: AbortScope): Promise<Outcome<BackupImportResult>> {
  const stopped = outcomeIfAborted(scope);
  if (stopped != null) return stopped;
  const result = await importDatabaseBackup(BrowserWindow.getFocusedWindow());
  if (!result.ok) return { kind: "failed", error: result.error };
  if (result.value === "imported") {
    const rebuilt = await rebootstrapDesktopRuntime();
    if (!rebuilt.ok) return { kind: "failed", error: rebuilt.error };
  }
  return { kind: "completed", value: result.value };
}
