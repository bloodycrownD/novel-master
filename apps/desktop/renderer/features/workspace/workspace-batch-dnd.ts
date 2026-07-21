/**
 * Workspace 批量 ingest/export 编排（renderer）：冲突确认、toast、startDrag。
 *
 * 拖出：pointerdown 预 stage → dragstart 同步 startDrag（避免 await 打断拖动手势）。
 * 回落到树内且路径属于 stagingRoot → 按原逻辑路径 move；外部 Files → ingest。
 * 物化 / startDrag 失败 → toast（Spec Step 3）。
 */
import type {
  VfsBatchApplyReportDto,
  VfsScopeRequest,
} from "@shared/ipc-types";
import {
  getDesktopBridge,
  ipcVfsBatchExportStage,
  ipcVfsBatchIngestFromPaths,
  ipcVfsRename,
  onVfsStartDragFailed,
} from "@/ipc/client";
import { showToast } from "@/components/ui/show-toast";
import {
  dropTargetDir,
  isSelfOrAncestorPath,
  resolveMoveDestination,
} from "./vfs-tree-dnd";

export type ActiveNativeDrag = {
  readonly logicalPaths: readonly string[];
  readonly stagingRoot: string;
};

export type StagedExport = {
  readonly logicalPaths: readonly string[];
  readonly stagingRoot: string;
  readonly filePaths: readonly string[];
};

let activeNativeDrag: ActiveNativeDrag | null = null;
const stagedByPath = new Map<string, StagedExport>();
/** prefetch 已失败的路径：dragstart 无 staged 时补 toast（避免与 prefetch toast 重复）。 */
const failedStagePaths = new Set<string>();
let startDragFailedUnsub: (() => void) | null = null;

/** 订阅 main startDrag 失败事件（幂等）。 */
export function ensureStartDragFailureToast(): () => void {
  if (startDragFailedUnsub == null) {
    startDragFailedUnsub = onVfsStartDragFailed((payload) => {
      clearActiveNativeDrag();
      showToast(payload.message || "拖出失败");
    });
  }
  return () => {
    startDragFailedUnsub?.();
    startDragFailedUnsub = null;
  };
}

export function getActiveNativeDrag(): ActiveNativeDrag | null {
  return activeNativeDrag;
}

export function clearActiveNativeDrag(): void {
  activeNativeDrag = null;
}

export function formatBatchApplyToast(report: VfsBatchApplyReportDto): string {
  const parts: string[] = [];
  if (report.written.length > 0) {
    parts.push(`已写入 ${report.written.length}`);
  }
  if (report.skipped.length > 0) {
    parts.push(`跳过 ${report.skipped.length}`);
  }
  if (report.failed.length > 0) {
    parts.push(`失败 ${report.failed.length}`);
  }
  if (parts.length === 0) {
    return "导入完成（无变更）";
  }
  return `导入完成：${parts.join("，")}`;
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
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}\\`) ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

export type BatchIngestConfirmRequest = {
  readonly scope: VfsScopeRequest;
  readonly targetDir: string;
  readonly hostPaths: readonly string[];
  readonly conflictCount: number;
};

/** pointerdown 时预物化，供随后 dragstart 同步 startDrag。失败须 toast。 */
export async function prefetchExportStage(options: {
  readonly scope: VfsScopeRequest;
  readonly logicalPath: string;
}): Promise<void> {
  try {
    const result = await ipcVfsBatchExportStage({
      ...options.scope,
      logicalPaths: [options.logicalPath],
    });
    if (!result.ok) {
      stagedByPath.delete(options.logicalPath);
      failedStagePaths.add(options.logicalPath);
      showToast(result.error.message || "导出物化失败");
      return;
    }
    failedStagePaths.delete(options.logicalPath);
    stagedByPath.set(options.logicalPath, {
      logicalPaths: [options.logicalPath],
      stagingRoot: result.data.stagingRoot,
      filePaths: result.data.filePaths,
    });
  } catch (err) {
    stagedByPath.delete(options.logicalPath);
    failedStagePaths.add(options.logicalPath);
    showToast(err instanceof Error ? err.message : "导出物化失败");
  }
}

/**
 * dragstart：若已 prefetch 则 preventDefault + startDrag；否则保留 HTML5 MIME 供树内移动。
 * prefetch 已失败且无 staged → toast（不可静默）。
 */
export function startPrefetchedNativeDrag(options: {
  readonly logicalPath: string;
  readonly dragEvent: DragEvent;
}): boolean {
  const staged = stagedByPath.get(options.logicalPath);
  if (staged == null) {
    if (failedStagePaths.has(options.logicalPath)) {
      // prefetch 已 toast；清除标记，避免重复提示
      failedStagePaths.delete(options.logicalPath);
    }
    return false;
  }
  options.dragEvent.preventDefault();
  activeNativeDrag = {
    logicalPaths: staged.logicalPaths,
    stagingRoot: staged.stagingRoot,
  };
  try {
    getDesktopBridge().startDrag(staged.filePaths);
    return true;
  } catch (err) {
    clearActiveNativeDrag();
    showToast(err instanceof Error ? err.message : "拖出失败");
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
    showToast("无法读取拖入的本机文件");
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
    showToast(`跳过 ${result.data.skippedBinary.length} 个非 UTF-8 文件`);
  }
}

export async function confirmAndApplyBatchIngest(
  req: BatchIngestConfirmRequest,
  onApplied: () => void,
): Promise<void> {
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
    showToast("导入未完成");
    return;
  }
  onApplied();
  showToast(formatBatchApplyToast(result.data.report));
  if (result.data.skippedBinary.length > 0) {
    showToast(`跳过 ${result.data.skippedBinary.length} 个非 UTF-8 文件`);
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
      showToast("不能移动到自身或子目录");
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
  const active = activeNativeDrag;
  const hostPaths = hostPathsFromDataTransfer(options.dataTransfer);

  if (
    active != null &&
    hostPaths.length > 0 &&
    hostPaths.every((p) => isPathUnderRoot(p, active.stagingRoot))
  ) {
    clearActiveNativeDrag();
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

export function resolveDropTargetDir(
  rowPath: string | null,
  rowKind: "dir" | "file" | null,
): string {
  return dropTargetDir(rowPath, rowKind);
}
