/**
 * SessionFs IPC handlers — execute batches, rollback to message.
 *
 * @module ipc/handlers/session-fs
 */
import type {
  IpcResult,
  SessionFsExecuteRequest,
  SessionFsRollbackRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";

function formatError(err: unknown): { code: string; message: string } {
  if (err instanceof Error) {
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}

export async function handleSessionFsExecute(
  req: SessionFsExecuteRequest,
): Promise<IpcResult<{ batchId: string }>> {
  try {
    const rt = await getDesktopRuntime();
    const result = await rt.sessionFs.execute(
      req.sessionId,
      req.projectId,
      [...req.actions],
      req.actor,
      req.expectedVersion != null
        ? {
            expectedVersion: req.expectedVersion,
            versionCheck: req.versionCheck !== false,
          }
        : { versionCheck: req.versionCheck ?? false },
    );
    rt.macroCache.clear(req.projectId, req.sessionId);
    return { ok: true, data: { batchId: result.batchId } };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handleSessionFsRollback(
  req: SessionFsRollbackRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.sessionFs.rollbackToMessage(
      req.sessionId,
      req.projectId,
      req.messageId,
    );
    rt.macroCache.clear(req.projectId, req.sessionId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}
