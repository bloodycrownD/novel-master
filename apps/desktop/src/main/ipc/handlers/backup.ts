/**
 * Database backup IPC — export/import with rebootstrap on import.
 *
 * 取消（signal-abort-scope §五）：`doWork` 返回 `Outcome`，handler 边界按
 * `RunScope.abortable` 的三分派收口。两组策略：
 * - export：原生保存对话框 **resolve 之后**才建 scope 并登记（对话框期间无取消面）；
 *   timeout 300s 只覆盖 copy 段；copyFile 前的检查点在
 *   `db-backup.service` 的「对话框 → 拷贝」原子段内。
 * - import：不设 timeout；仅入口检查点，`close → 覆盖库文件 → restore` 整段
 *   不可中断，**禁止 race 早 settle**（补偿链必须与底层流程同生命周期）。
 *   库已换代时 rebootstrap 无条件执行，成功即按自然终态返回。
 */
import { ABORT_KEY, type AbortScope } from "@novel-master/core/abort";
import { RequestAbort } from "@novel-master/core/llm-protocol";
import type { Outcome } from "@novel-master/core/errors";
import { BrowserWindow } from "electron";
import type { BackupExportResult, BackupImportResult, IpcResult } from "../../../../shared/ipc-types.js";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import type { DesktopNovelMasterRuntime } from "../../runtime/types.js";
import { DbBackupService } from "../../services/db-backup.service.js";
import { maintenanceBusy } from "../../services/db-maintenance-busy.js";
import { FormatIpcError } from "../format-ipc-error.js";
import { IpcResults } from "../ipc-result.js";
import { RunScope } from "../run-scope.js";

/** 可选请求体：runId 只在会展示取消按钮的调用方生成。 */
export type BackupRunRequest = { readonly runId?: string };

export const Backup = {
  async handleExport(req?: BackupRunRequest): Promise<IpcResult<BackupExportResult>> {
    const built = await DesktopRuntimeSingleton.get();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
    const rt = built.value;
    // 策略表：scope（含 300s deadline）在原生保存对话框 resolve 后创建；对话框
    // 期间的 abort 不承诺生效，deadline 也不该消耗在模态窗口上。
    const picked = await DbBackupService.pickExportPath(BrowserWindow.getFocusedWindow());
    if (!picked.ok) return IpcResults.err(FormatIpcError.format(picked.error));
    if (picked.value == null) return IpcResults.ok("cancelled");
    const destPath = picked.value;
    return RunScope.abortable({ registry: rt.abortRegistry, key: RunScope.key(ABORT_KEY.backup, req?.runId), timeoutMs: 300_000 }, (scope) => Backup.export(rt, destPath, scope));
  },

  /** 可被中断的备份导出段（对话框已 resolve，只剩 copyFile）；检查点命中返回 `Outcome.cancelled`。 */
  // nm-style: keep-local — run-abort-scope.test 直引断言取消/完成分支；内联会破坏测试锁名。
  async export(rt: DesktopNovelMasterRuntime, destPath: string, scope: AbortScope): Promise<Outcome<BackupExportResult>> {
    const stopped = RunScope.outcomeIfAborted(scope);
    if (stopped != null) return stopped;
    try {
      // 中断沿返回值上行（Outcome 通道）：cancelled/replaced 原样透传给 handler 消费方。
      const exported = await DbBackupService.exportToPath(rt, destPath, () => scope.checkpoint());
      return exported.kind === "completed" ? { kind: "completed", value: "saved" } : exported;
    } catch (err) {
      // 兜底：未来 throw 源的 AbortError 转回控制流 Outcome。
      if (RequestAbort.isAbortLikeError(err)) return { kind: "cancelled", reason: scope.reason ?? "user-stop" };
      throw err;
    }
  },

  async handleImport(req?: BackupRunRequest): Promise<IpcResult<BackupImportResult>> {
    // ic-20 外层令牌：busy 为计数/令牌配对——底层 importDatabaseBackupFromBytes
    // 已 acquire/release 自平衡；这里再持一枚，覆盖「库文件已替换、
    // rebootstrap 尚未完成」的重建窗口，release 严格在 rebootstrap 完成之后
    // （finally 兜底失败路径）。计数语义下与底层令牌互不提前清位。
    maintenanceBusy.acquire();
    try {
      const built = await DesktopRuntimeSingleton.get();
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      return await RunScope.abortable({ registry: rt.abortRegistry, key: RunScope.key(ABORT_KEY.backup, req?.runId) }, (scope) => Backup.import(scope));
    } finally {
      maintenanceBusy.release();
    }
  },

  /**
   * 备份导入段：`close → 覆盖 → restore` 不可中断，因此**只有入口检查点**，
   * 完成之后不再判取消——库已换代却回 `IPC_ABORTED` 会让用户以为没导入。
   */
  // nm-style: keep-local — run-abort-scope.test 直引断言导入段取消语义；内联会破坏测试锁名。
  async import(scope: AbortScope): Promise<Outcome<BackupImportResult>> {
    const stopped = RunScope.outcomeIfAborted(scope);
    if (stopped != null) return stopped;
    const result = await DbBackupService.importWithDialog(BrowserWindow.getFocusedWindow());
    if (!result.ok) return { kind: "failed", error: result.error };
    if (result.value === "imported") {
      const rebuilt = await DesktopRuntimeSingleton.rebootstrap();
      if (!rebuilt.ok) return { kind: "failed", error: rebuilt.error };
    }
    return { kind: "completed", value: result.value };
  },
} as const;
