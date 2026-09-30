/**
 * 手动压缩 IPC —— 直调 runCompaction（hide-message + kkv 清理 + token cache 失效）。
 *
 * 成功后触发 composer status 刷新（置位/压缩同口径：project∪annotate），
 * 并在返回前把上下文占用 chip 的精确档暖好（见下方注释）。
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
import { warmChatPromptTokenStatsAfterCompaction } from "../../services/chat-prompt-tokens.service.js";
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
      // 压缩会作废 API 基线，renderer 压缩完成后立刻触发的刷新首帧必然落到
      // 廉价估算档（内容指纹全变、L1 必 miss）→ 用户看到 chip 从压缩前的
      // `glm =` 跳到 `gpt ≈`、再 ~1~2s 后跳回精确档。
      //
      // 这里**在 IPC 返回之前**把精确档暖好（完整口径 resolve + L1 整串写入），
      // 于是 renderer 那次刷新的首帧经 core 读口的 L1 预查直接命中精确档，
      // 跳变整段消失。必须是 await：fire-and-forget 只是把竞态从「首帧 vs 后台
      // 暖机」换成「首帧 vs IPC 后续时序」，跳变照旧。
      //
      // 代价是压缩动作多等 ~0.3~1s（在「用户主动等压缩完成」的场景里可接受），
      // 且暖机失败静默——绝不让锦上添花把压缩的成功态翻成失败态。
      await warmChatPromptTokenStatsAfterCompaction(rt, {
        projectId: req.projectId,
        sessionId: req.sessionId,
      });
    }
    return { ok: true, data: { ok: result.ok } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
