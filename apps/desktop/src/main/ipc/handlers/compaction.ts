/**
 * Manual compaction IPC — emits session.compaction.requested via event orchestrator.
 * 成功后的 session kkv 清空由 Core EventOrchestrator.emit 统一处理。
 */
import { EVENT_SESSION_COMPACTION_REQUESTED } from "@novel-master/core/events";
import type {
  CompactionManualRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { notifyComposerStatusAfterFloorOrCompaction } from "../../services/notify-composer-status-after-kkv-clear.js";
import { formatIpcError } from "../format-ipc-error.js";

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
    if (result.ok) {
      // 置位/压缩：project∪annotate；禁止终态强制 []
      await notifyComposerStatusAfterFloorOrCompaction(rt, req.sessionId);
    }
    return { ok: true, data: { ok: result.ok } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
