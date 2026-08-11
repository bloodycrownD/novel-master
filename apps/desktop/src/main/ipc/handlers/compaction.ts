/**
 * 手动压缩 IPC —— 直调 runCompaction（hide-message + kkv 清理 + token cache 失效）。
 *
 * 成功后触发 composer status 刷新（置位/压缩同口径：project∪annotate）。
 */
import {
  runCompaction,
  type RunCompactionDeps,
} from "@novel-master/core/compaction";
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
    const deps: RunCompactionDeps = {
      sessionKkv: rt.sessionKkv,
      messages: rt.messages,
      messageTranscriptEffects: rt.messageTranscriptEffects,
    };
    const hideStartDepth =
      await rt.compactionConditionEvaluator.getHideStartDepth();
    const result = await runCompaction(deps, {
      sessionId: req.sessionId,
      projectId: req.projectId,
      hideStartDepth,
    });
    if (result.ok) {
      // 置位/压缩：project∪annotate；禁止终态强制 []
      await notifyComposerStatusAfterFloorOrCompaction(rt, req.sessionId);
    }
    return { ok: true, data: { ok: result.ok } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
