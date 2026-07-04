/**
 * VFS IPC handlers �?list/read/write/mkdir/delete/rename for global/project/session scopes.
 *
 * @module ipc/handlers/vfs
 */
import type {
  IpcResult,
  VfsDeleteRequest,
  VfsListEntryDto,
  VfsListRequest,
  VfsMkdirRequest,
  VfsReadRequest,
  VfsReadResultDto,
  VfsRenameRequest,
  VfsScopeRequest,
  VfsWriteRequest,
  VfsZipExportResult,
  VfsZipImportResult,
  VfsZipRequest,
} from "../../../../shared/ipc-types.js";
import { isUserVfsUnifiedToolTurnEnabled } from "@novel-master/core/feature-flags";
import { VfsError, isVfsError } from "@novel-master/core/vfs";

import {
  buildUserVfsDeleteOp,
  buildUserVfsMkdirOp,
  buildUserVfsRenameOp,
  buildUserVfsSaveOp,
  readUserVfsSaveBaseline,
} from "@novel-master/core/vfs";
import { BrowserWindow } from "electron";
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
  exportVfsZipWithDialog,
  importVfsZipWithDialog,
} from "../../services/vfs-zip.service.js";
import {
  getVfsForScope,
  getWorktreeForScope,
  invalidateSessionWorktreeSnapshot,
  resolveVfsScopeFromRequest,
} from "../resolve-vfs-scope.js";
import {
  notifyWorkspaceMutatedToRenderer,
  workspaceMutatedPayloadFromRequest,
} from "../forward-workspace-mutated.js";

function formatError(err: unknown): { code: string; message: string } {
  if (err instanceof VfsError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error && err.name === "ToolError") {
    const toolErr = err as Error & { code?: string; cause?: unknown };
    const cause = toolErr.cause;
    if (cause instanceof VfsError || isVfsError(cause)) {
      const vfsCause = cause as VfsError;
      return { code: vfsCause.code, message: vfsCause.message };
    }
    const message =
      cause instanceof Error ? cause.message : err.message;
    return { code: toolErr.code ?? err.name, message };
  }
  if (err instanceof Error) {
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}

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
    return { ok: false, error: formatError(err) };
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
    return { ok: false, error: formatError(err) };
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
    return { ok: false, error: formatError(err) };
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
    return { ok: false, error: formatError(err) };
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

    const wt = getWorktreeForScope(rt, scope);
    await wt.deleteRulesUnderLogicalPrefix(req.path);
    invalidateSessionWorktreeSnapshot(rt, scope);

    pushWorkspaceMutated(req);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatError(err) };
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
    return { ok: false, error: formatError(err) };
  }
}

export async function handleVfsZipExport(
  req: VfsZipRequest,
): Promise<IpcResult<VfsZipExportResult>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const result = await exportVfsZipWithDialog(rt, scope, focusedWindow());
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatError(err) };
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
      { confirmed: req.confirmed === true },
      focusedWindow(),
    );
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}
