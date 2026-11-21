/**
 * Workspace 批量 ingest/export 编排（renderer）：冲突确认、toast、startDrag。
 *
 * 拖出：pointerdown 预 stage → dragstart 同步 startDrag（避免 await 打断拖动手势）。
 * 回落到树内且路径属于 stagingRoot → 按原逻辑路径 move；外部 Files → ingest。
 * 物化 / startDrag 失败 → toast（Spec Step 3）。
 */
import type { VfsBatchApplyReportDto, VfsBatchExportSkippedDto, VfsScopeRequest } from "@shared/ipc-types";
import { getDesktopBridge, ipcVfsBatchClearStaging, ipcVfsBatchExportStage, ipcVfsBatchIngestFromPaths, ipcVfsRename, onVfsStartDragFailed } from "@/ipc/client";
import { showToast } from "@/components/ui/show-toast";
import { coreT } from "@shared/logic/core-i18n";
import { dropTargetDir, isSelfOrAncestorPath, resolveMoveDestination } from "./vfs-tree-dnd";

type ActiveNativeDrag = {
  readonly logicalPaths: readonly string[];
  readonly stagingRoot: string;
};

type StagedExport = {
  readonly logicalPaths: readonly string[];
  readonly stagingRoot: string;
  readonly filePaths: readonly string[];
  /**
   * 相对路径碰撞而被去重跳过的选中项，随 `ipc-types.ts` 的
   * `VfsBatchExportStageResult` 一起补齐（core2 B-2）。
   *
   * ⚠️ **债务**：UI 呈现是 spec §12.5 第 3 条列出的债务池，本模块**只存不读**。
   *   留着它的理由是「ZIP 里少了文件」这件事总得有地方落地提示；不要因为当前
   *   没人读就当死字段删掉。将来消费时并进 `prefetchStagedExport` 已有的
   *   `showToast` 分支即可。
   */
  readonly skipped?: readonly VfsBatchExportSkippedDto[];
};

/** 批量拖拽运行时槽（模块内 holder，对象管理）：在途原生拖拽与 prefetch 失败订阅。 */
const dndRuntime = {
  /** 当前在途的原生拖拽（null = 无在途）。 */
  active: null as ActiveNativeDrag | null,
  /** prefetch 失败 toast 的退订钩子（null = 未订阅）。 */
  failedUnsub: null as (() => void) | null,
};
const stagedByPath = new Map<string, StagedExport>();
/** prefetch 已失败的路径：dragstart 无 staged 时补 toast（避免与 prefetch toast 重复）。 */
const failedStagePaths = new Set<string>();
/** pointerdown 后 prefetch 尚未完成的路径。 */
const prefetchInFlight = new Set<string>();
/** dragEnd 递增以作废仍在途的 prefetch 结果。 */
const prefetchGeneration = new Map<string, number>();

function clearStagingOnMain(stagingRoot: string): void {
  void ipcVfsBatchClearStaging({ stagingRoot });
}

function removeStagedByRoot(stagingRoot: string): void {
  for (const [path, staged] of stagedByPath) {
    if (staged.stagingRoot === stagingRoot) {
      stagedByPath.delete(path);
    }
  }
}

/** 释放单路径 staging（renderer map + main 临时目录）。 */
export function releaseStagedExport(logicalPath: string): void {
  const staged = stagedByPath.get(logicalPath);
  if (staged == null) {
    return;
  }
  stagedByPath.delete(logicalPath);
  clearStagingOnMain(staged.stagingRoot);
}

/** dragEnd / 取消：清理 dndRuntime.active 与对应 staging。 */
export function finalizeRowDrag(logicalPath: string): void {
  prefetchGeneration.set(logicalPath, (prefetchGeneration.get(logicalPath) ?? 0) + 1);
  releaseStagedExport(logicalPath);
  if (dndRuntime.active != null) {
    clearStagingOnMain(dndRuntime.active.stagingRoot);
    removeStagedByRoot(dndRuntime.active.stagingRoot);
    dndRuntime.active = null;
  }
}

/** 订阅 main startDrag 失败事件（幂等）。 */
export function ensureStartDragFailureToast(): () => void {
  if (dndRuntime.failedUnsub == null) {
    dndRuntime.failedUnsub = onVfsStartDragFailed((payload) => {
      if (dndRuntime.active != null) {
        clearStagingOnMain(dndRuntime.active.stagingRoot);
        removeStagedByRoot(dndRuntime.active.stagingRoot);
      }
      dndRuntime.active = null;
      showToast(payload.message || coreT({key: "ui.vfs.drag_out_failed"}));
    });
  }
  return () => {
    dndRuntime.failedUnsub?.();
    dndRuntime.failedUnsub = null;
  };
}

export function clearActiveNativeDrag(): void {
  dndRuntime.active = null;
}

export function formatBatchApplyToast(report: VfsBatchApplyReportDto): string {
  const parts: string[] = [];
  if (report.written.length > 0) {
    parts.push(coreT({key: "ui.vfs.import_report_written", params: {count: report.written.length}}));
  }
  if (report.skipped.length > 0) {
    parts.push(coreT({key: "ui.vfs.import_report_skipped", params: {count: report.skipped.length}}));
  }
  if (report.failed.length > 0) {
    parts.push(coreT({key: "ui.vfs.import_report_failed", params: {count: report.failed.length}}));
  }
  if (parts.length === 0) {
    return coreT({key: "ui.vfs.import_done_nochange"});
  }
  return coreT({key: "ui.vfs.import_done_report", params: {report: parts.join("，")}});
}

/**
 * 非 UTF-8 文件被跳过的 toast 文案。
 *
 * 批量 ingest 只有这一层看得到「跳过了几个」（被跳过的文件根本没写库，回不上 VFS），
 * 所以拖入链路两处与菜单单文件链路共用同一句，避免第三处再抄一遍。
 */
export function skippedBinaryToastMessage(count: number): string {
  return coreT({key: "ui.vfs.skip_non_utf8", params: {count}});
}

function hostPathsFromDataTransfer(dt: DataTransfer): string[] {
  const bridge = getDesktopBridge();
  const paths: string[] = [];
  for (const file of Array.from(dt.files)) {
    try {
      const p = bridge.getPathForFile(file);
      if (p) {
        paths.push(p);
      }
    } catch {
      // ignore
    }
  }
  return paths;
}

function isPathUnderRoot(filePath: string, root: string): boolean {
  const normalizedRoot = root.replace(/[/\\]+$/, "");
  const normalizedPath = filePath.replace(/[/\\]+$/, "");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`) || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export type BatchIngestConfirmRequest = {
  readonly scope: VfsScopeRequest;
  readonly targetDir: string;
  readonly hostPaths: readonly string[];
  readonly conflictCount: number;
};

/** pointerdown 时预物化，供随后 dragstart 同步 startDrag。失败须 toast。 */
export async function prefetchExportStage(options: { readonly scope: VfsScopeRequest; readonly logicalPath: string }): Promise<void> {
  releaseStagedExport(options.logicalPath);
  const generation = prefetchGeneration.get(options.logicalPath) ?? 0;
  prefetchInFlight.add(options.logicalPath);
  try {
    const result = await ipcVfsBatchExportStage({
      ...options.scope,
      logicalPaths: [options.logicalPath],
    });
    if (prefetchGeneration.get(options.logicalPath) !== generation) {
      if (result.ok) {
        clearStagingOnMain(result.data.stagingRoot);
      }
      return;
    }
    if (!result.ok) {
      stagedByPath.delete(options.logicalPath);
      failedStagePaths.add(options.logicalPath);
      showToast(result.error.message || coreT({key: "ui.vfs.export_materialize_failed"}));
      return;
    }
    failedStagePaths.delete(options.logicalPath);
    stagedByPath.set(options.logicalPath, {
      logicalPaths: [options.logicalPath],
      stagingRoot: result.data.stagingRoot,
      filePaths: result.data.filePaths,
      // 只存不读：UI 呈现是 spec §12.5 第 3 条的债务池，见 StagedExport.skipped 注释。
      skipped: result.data.skipped,
    });
  } catch (err) {
    stagedByPath.delete(options.logicalPath);
    failedStagePaths.add(options.logicalPath);
    showToast(err instanceof Error ? err.message : coreT({key: "ui.vfs.export_materialize_failed"}));
  } finally {
    prefetchInFlight.delete(options.logicalPath);
  }
}

/**
 * dragstart：若已 prefetch 则 preventDefault + startDrag；否则保留 HTML5 MIME 供树内移动。
 * prefetch 已失败且无 staged → toast（不可静默）。
 */
export function startPrefetchedNativeDrag(options: { readonly logicalPath: string; readonly dragEvent: DragEvent }): boolean {
  if (prefetchInFlight.has(options.logicalPath)) {
    showToast(coreT({key: "ui.vfs.export_preparing"}));
    return false;
  }
  const staged = stagedByPath.get(options.logicalPath);
  if (staged == null) {
    if (failedStagePaths.has(options.logicalPath)) {
      // prefetch 已 toast；清除标记，避免重复提示
      failedStagePaths.delete(options.logicalPath);
    }
    return false;
  }
  options.dragEvent.preventDefault();
  dndRuntime.active = {
    logicalPaths: staged.logicalPaths,
    stagingRoot: staged.stagingRoot,
  };
  try {
    getDesktopBridge().startDrag(staged.filePaths);
    return true;
  } catch (err) {
    clearStagingOnMain(staged.stagingRoot);
    removeStagedByRoot(staged.stagingRoot);
    dndRuntime.active = null;
    showToast(err instanceof Error ? err.message : coreT({key: "ui.vfs.drag_out_failed"}));
    return false;
  }
}

export async function handleFilesDropIngest(options: {
  readonly scope: VfsScopeRequest;
  readonly targetDir: string;
  readonly dataTransfer: DataTransfer;
  readonly onNeedsConfirm: (req: BatchIngestConfirmRequest) => void;
  readonly onApplied: () => void;
}): Promise<void> {
  const hostPaths = hostPathsFromDataTransfer(options.dataTransfer);
  if (hostPaths.length === 0) {
    showToast(coreT({key: "ui.vfs.local_file_read_failed"}));
    return;
  }

  const result = await ipcVfsBatchIngestFromPaths({
    ...options.scope,
    targetDir: options.targetDir,
    hostPaths,
    overwriteConfirmed: false,
  });
  if (!result.ok) {
    showToast(result.error.message);
    return;
  }

  if (result.data.status === "needs_confirm") {
    options.onNeedsConfirm({
      scope: options.scope,
      targetDir: options.targetDir,
      hostPaths,
      conflictCount: result.data.conflicts.length,
    });
    return;
  }

  options.onApplied();
  showToast(formatBatchApplyToast(result.data.report));
  if (result.data.skippedBinary.length > 0) {
    showToast(skippedBinaryToastMessage(result.data.skippedBinary.length));
  }
}

export async function confirmAndApplyBatchIngest(req: BatchIngestConfirmRequest, onApplied: () => void): Promise<void> {
  const result = await ipcVfsBatchIngestFromPaths({
    ...req.scope,
    targetDir: req.targetDir,
    hostPaths: req.hostPaths,
    overwriteConfirmed: true,
  });
  if (!result.ok) {
    showToast(result.error.message);
    return;
  }
  if (result.data.status !== "applied") {
    showToast(coreT({key: "ui.vfs.import_incomplete"}));
    return;
  }
  onApplied();
  showToast(formatBatchApplyToast(result.data.report));
  if (result.data.skippedBinary.length > 0) {
    showToast(skippedBinaryToastMessage(result.data.skippedBinary.length));
  }
}

export async function moveVfsPathsToDir(options: {
  readonly scope: VfsScopeRequest;
  readonly targetDir: string;
  readonly sourcePaths: readonly string[];
  readonly onMoved: () => void;
}): Promise<void> {
  let moved = 0;
  for (const sourcePath of options.sourcePaths) {
    if (isSelfOrAncestorPath(sourcePath, options.targetDir)) {
      showToast(coreT({key: "ui.vfs.move_self_blocked"}));
      continue;
    }
    const newPath = resolveMoveDestination(sourcePath, options.targetDir);
    if (newPath === sourcePath) {
      continue;
    }
    const result = await ipcVfsRename({
      ...options.scope,
      oldPath: sourcePath,
      newPath,
    });
    if (!result.ok) {
      showToast(result.error.message);
      continue;
    }
    moved += 1;
  }
  if (moved > 0) {
    options.onMoved();
  }
}

/**
 * 统一 drop：本次 startDrag 回落 → move；外部 Files → ingest。
 * 亦支持自定义 MIME（无 startDrag 时的纯树内拖动兜底）。
 */
export async function handleTreeDrop(options: {
  readonly scope: VfsScopeRequest;
  readonly targetDir: string;
  readonly dataTransfer: DataTransfer;
  readonly onNeedsConfirm: (req: BatchIngestConfirmRequest) => void;
  readonly onMutated: () => void;
}): Promise<void> {
  const active = dndRuntime.active;
  const hostPaths = hostPathsFromDataTransfer(options.dataTransfer);

  if (active != null && hostPaths.length > 0 && hostPaths.every((p) => isPathUnderRoot(p, active.stagingRoot))) {
    clearStagingOnMain(active.stagingRoot);
    removeStagedByRoot(active.stagingRoot);
    dndRuntime.active = null;
    await moveVfsPathsToDir({
      scope: options.scope,
      targetDir: options.targetDir,
      sourcePaths: active.logicalPaths,
      onMoved: options.onMutated,
    });
    return;
  }

  clearActiveNativeDrag();

  if (hostPaths.length > 0) {
    await handleFilesDropIngest({
      scope: options.scope,
      targetDir: options.targetDir,
      dataTransfer: options.dataTransfer,
      onNeedsConfirm: options.onNeedsConfirm,
      onApplied: options.onMutated,
    });
  }
}

export function resolveDropTargetDir(rowPath: string | null, rowKind: "dir" | "file" | null): string {
  return dropTargetDir(rowPath, rowKind);
}
