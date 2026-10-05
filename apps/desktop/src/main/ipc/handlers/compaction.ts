/**
 * 手动压缩 IPC —— 直调 runCompaction（hide-message + kkv 清理 + token cache 失效）。
 *
 * 成功后触发 composer status 刷新（置位/压缩同口径：project∪annotate），
 * 并在返回前把上下文占用 chip 的精确档暖好（见下方注释）。
 *
 * **run 在途门禁**：Agent 回合在跑时拒绝手动压缩（与置位/回滚/分叉的 running
 * 拦截同口径）。判活源复用 {@link isDesktopSessionRunInFlight}（core
 * abortRegistry，判据写在 agent.ts，import 方向与 chat-prompt-tokens.service
 * 一致、单向无环）。renderer 侧**不做**预拦截：`handleCompactionManual` 的
 * 包装函数在模块级，拿不到组件的 running 态，所以 main 侧门禁是唯一守卫；
 * renderer 现有 `!result.ok → showToast(result.error.message)` 链路会自动
 * 弹出这里的文案，零改动。
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
import { isDesktopSessionRunInFlight } from "./agent.js";

export async function handleCompactionManual(
  req: CompactionManualRequest,
): Promise<IpcResult<{ ok: boolean }>> {
  try {
    const rt = await getDesktopRuntime();
    // run 在途即拒：压缩是 hide-message 式的可见性重排，落在回合中段会与
    // core 那边「回合内前缀冻结」的自动压缩语义打架。返回既有 IpcResult 失败
    // 分支（不引入 data 层 reason 字段，IPC 契约零变更）。
    if (isDesktopSessionRunInFlight(rt, req.sessionId)) {
      return {
        ok: false,
        error: { code: "run-in-flight", message: "Agent 运行中无法压缩" },
      };
    }
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
      // 手动压缩：core 侧据此清 `rule_snapshot` + `file_cache` 两域，下一次拼
      // 提示词（发送或预览）时 workplace 块按当前工作区重评估。自动压缩不传、
      // 缺省 auto，不清（保住「回合内前缀冻结」）。
      trigger: "manual",
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
