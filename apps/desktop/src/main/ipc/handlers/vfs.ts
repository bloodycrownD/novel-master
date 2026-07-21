/**
 * VFS IPC handlers �?list/read/write/mkdir/delete/rename for global/project/session scopes.
 *
 * @module ipc/handlers/vfs
 */
import type {
  IpcResult,
  UserVfsHasPendingRequest,
  VfsBatchExportStageRequest,
  VfsBatchExportStageResult,
  VfsBatchIngestFromPathsRequest,
  VfsBatchIngestFromPathsResult,
  VfsDeleteRequest,
  VfsListEntryDto,
  VfsListRequest,
  VfsMkdirRequest,
  VfsReadRequest,
  VfsReadResultDto,
  VfsRenameRequest,
  VfsScopeRequest,
  VfsStartDragRequest,
  VfsStartDragFailedPayload,
  VfsWriteRequest,
  VfsZipExportResult,
  VfsZipImportResult,
  VfsZipRequest,
} from "../../../../shared/ipc-types.js";
import { IPC_CHANNELS } from "../../../../shared/ipc-types.js";
import { isUserVfsUnifiedToolTurnEnabled } from "@novel-master/core/feature-flags";

import {
  buildUserVfsDeleteOp,
  buildUserVfsMkdirOp,
  buildUserVfsRenameOp,
  buildUserVfsSaveOp,
  readUserVfsSaveBaseline,
} from "@novel-master/core/vfs";
import { BrowserWindow, type IpcMainEvent } from "electron";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import {
  deleteVfsEntry,
  renameVfsDirectory,
  renameVfsFile,
} from "../../services/vfs-operations.service.js";
import {
  executeSessionUserVfsOp,
  isSessionVfsScope,
} from "../../services/user-vfs-turn-execute.service.js";
import {
  ingestVfsFromHostPaths,
  stageVfsBatchExport,
  startDragExport,
} from "../../services/vfs-batch.service.js";
import {
  exportVfsZipWithDialog,
  importVfsZipWithDialog,
} from "../../services/vfs-zip.service.js";
import {
  getVfsForScope,
  getWorkplaceForScope,
  resolveVfsScopeFromRequest,
} from "../resolve-vfs-scope.js";
import {
  notifyWorkspaceMutatedToRenderer,
  workspaceMutatedPayloadFromRequest,
} from "../forward-workspace-mutated.js";
import { formatIpcError } from "../format-ipc-error.js";

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? undefined;
}

/** VFS 变更成功后通知 renderer 刷新 Explorer（消费方 ①）�?*/
function pushWorkspaceMutated(req: VfsScopeRequest): void {
  notifyWorkspaceMutatedToRenderer(workspaceMutatedPayloadFromRequest(req));
}

async function readBaselineContent(
  vfs: Awaited<ReturnType<typeof getVfsForScope>>,
  path: string,
): Promise<string | null> {
  return readUserVfsSaveBaseline(vfs, path);
}

export async function handleVfsList(
  req: VfsListRequest,
): Promise<IpcResult<VfsListEntryDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const vfs = getVfsForScope(rt, scope);
    const entries = await vfs.list(req.path, { recursive: req.recursive });
    return {
      ok: true,
      data: entries.map((e) => ({
        path: e.path,
        kind: e.kind === "directory" ? "directory" : "file",
      })),
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleVfsRead(
  req: VfsReadRequest,
): Promise<IpcResult<VfsReadResultDto>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const vfs = getVfsForScope(rt, scope);
    const result = await vfs.read(req.path);
    return {
      ok: true,
      data: {
        content: result.content,
        version: result.version,
        mtimeMs: result.mtimeMs,
      },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleVfsWrite(
  req: VfsWriteRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const vfs = getVfsForScope(rt, scope);

    if (isSessionVfsScope(scope) && isUserVfsUnifiedToolTurnEnabled()) {
      const baseline = await readBaselineContent(vfs, req.path);
      if (
        req.lastKnownContent != null &&
        baseline != null &&
        req.lastKnownContent !== baseline
      ) {
        console.info("[user-vfs-turn] external_drift_detected", {
          path: req.path,
        });
      }
      const op = buildUserVfsSaveOp(
        baseline,
        req.content,
        req.path,
        req.content,
        {
          expectedVersion: req.expectedVersion,
          versionCheck: req.versionCheck,
        },
      );
      if (op != null) {
        await executeSessionUserVfsOp(rt, scope.sessionId, op);
      }
      pushWorkspaceMutated(req);
      return { ok: true, data: undefined };
    }

    if (req.expectedVersion != null) {
      await vfs.write(req.path, req.content, {
        expectedVersion: req.expectedVersion,
        versionCheck: req.versionCheck !== false,
      });
    } else {
      await vfs.write(req.path, req.content, {
        versionCheck: req.versionCheck ?? false,
      });
    }
    pushWorkspaceMutated(req);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleVfsMkdir(
  req: VfsMkdirRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);

    if (isSessionVfsScope(scope) && isUserVfsUnifiedToolTurnEnabled()) {
      await executeSessionUserVfsOp(
        rt,
        scope.sessionId,
        buildUserVfsMkdirOp(req.path),
      );
      pushWorkspaceMutated(req);
      return { ok: true, data: undefined };
    }

    const vfs = getVfsForScope(rt, scope);
    await vfs.mkdir(req.path);
    pushWorkspaceMutated(req);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleVfsDelete(
  req: VfsDeleteRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const recursive = req.recursive ?? true;

    if (isSessionVfsScope(scope) && isUserVfsUnifiedToolTurnEnabled()) {
      await executeSessionUserVfsOp(
        rt,
        scope.sessionId,
        buildUserVfsDeleteOp(req.path, recursive),
      );
    } else {
      const vfs = getVfsForScope(rt, scope);
      await deleteVfsEntry(vfs, req.path, { recursive });
    }

    const wt = getWorkplaceForScope(rt, scope);
    await wt.deleteRulesUnderLogicalPrefix(req.path);

    pushWorkspaceMutated(req);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleVfsRename(
  req: VfsRenameRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);

    if (isSessionVfsScope(scope) && isUserVfsUnifiedToolTurnEnabled()) {
      await executeSessionUserVfsOp(
        rt,
        scope.sessionId,
        buildUserVfsRenameOp(req.oldPath, req.newPath),
      );
      pushWorkspaceMutated(req);
      return { ok: true, data: undefined };
    }

    const vfs = getVfsForScope(rt, scope);
    const parentPath =
      req.oldPath.lastIndexOf("/") > 0
        ? req.oldPath.slice(0, req.oldPath.lastIndexOf("/"))
        : "/";
    const siblings = await vfs.list(parentPath);
    const entry = siblings.find((e) => e.path === req.oldPath);
    if (entry?.kind === "directory") {
      await renameVfsDirectory(vfs, req.oldPath, req.newPath);
    } else {
      await renameVfsFile(vfs, req.oldPath, req.newPath);
    }
    pushWorkspaceMutated(req);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleVfsZipExport(
  req: VfsZipRequest,
): Promise<IpcResult<VfsZipExportResult>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const result = await exportVfsZipWithDialog(
      rt,
      scope,
      { directoryPath: req.directoryPath },
      focusedWindow(),
    );
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleVfsZipImport(
  req: VfsZipRequest,
): Promise<IpcResult<VfsZipImportResult>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const result = await importVfsZipWithDialog(
      rt,
      scope,
      {
        confirmed: req.confirmed === true,
        directoryPath: req.directoryPath,
      },
      focusedWindow(),
    );
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleVfsBatchIngestFromPaths(
  req: VfsBatchIngestFromPathsRequest,
): Promise<IpcResult<VfsBatchIngestFromPathsResult>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const outcome = await ingestVfsFromHostPaths(rt, scope, {
      targetDir: req.targetDir,
      hostPaths: req.hostPaths,
      overwriteConfirmed: req.overwriteConfirmed === true,
    });
    if (outcome.status === "applied") {
      pushWorkspaceMutated(req);
    }
    return { ok: true, data: outcome };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleVfsBatchExportStage(
  req: VfsBatchExportStageRequest,
): Promise<IpcResult<VfsBatchExportStageResult>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const staged = await stageVfsBatchExport(rt, scope, req.logicalPaths);
    return { ok: true, data: staged };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * Preload 经 ipcRenderer.send 触发；须在 dragstart 流程中尽快调用 startDrag。
 * 失败经 VFS_START_DRAG_FAILED 推回 renderer toast（send 无 invoke 回传）。
 */
export function handleVfsStartDrag(
  event: IpcMainEvent,
  req: VfsStartDragRequest,
): void {
  try {
    startDragExport(event.sender, req.filePaths ?? []);
  } catch (err) {
    console.error("[vfs-batch] startDrag failed", err);
    const payload: VfsStartDragFailedPayload = {
      message: formatIpcError(err).message || "拖出失败",
    };
    if (!event.sender.isDestroyed()) {
      event.sender.send(IPC_CHANNELS.VFS_START_DRAG_FAILED, payload);
    }
  }
}

/** Composer 空发门闩：会话是否有 pending→user_ops。 */
export async function handleUserVfsHasPending(
  req: UserVfsHasPendingRequest,
): Promise<IpcResult<boolean>> {
  try {
    const rt = await getDesktopRuntime();
    const has = await rt.userVfsTurn.hasPendingTurns(req.sessionId);
    return { ok: true, data: has };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
