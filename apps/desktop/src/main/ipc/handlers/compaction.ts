/**
 * Manual compaction IPC — emits session.compaction.requested via event orchestrator.
 */
import { EVENT_SESSION_COMPACTION_REQUESTED } from "@novel-master/core";
import type {
  CompactionManualRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";

function formatError(err: unknown): { code: string; message: string } {
  if (err instanceof Error) {
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}

export async function handleCompactionManual(
  req: CompactionManualRequest,
): Promise<IpcResult<{ ok: boolean }>> {
  try {
    const rt = await getDesktopRuntime();
    const result = await rt.eventOrchestrator.emit(
      EVENT_SESSION_COMPACTION_REQUESTED,
      {
        sessionId: req.sessionId,
        projectId: req.projectId,
        trigger: "manual",
      },
    );
    return { ok: true, data: { ok: result.ok } };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}
