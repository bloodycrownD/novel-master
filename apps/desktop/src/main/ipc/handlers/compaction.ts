/**
 * 手动压缩 IPC —— 直调 runCompaction（hide-message + kkv 清理 + token cache 失效）。
 *
 * 成功后触发 composer status 刷新（置位/压缩同口径：project∪annotate）。
 *
 * 2026-10-07 起与置位走同一条实现路径（对齐 handleMessagesSetFloor）：核心操作
 * 落库即返回，**不做任何显式暖机**——token 读数交给 renderer chip 的常规两阶段
 * 刷新（估算首帧 + 后台精确升级）自然跟进。UI 读数不时间敏感，跳变/短暂旧值可
 * 接受（用户重新拍板放宽了「压缩跳变也消掉」的旧口径）。此前「IPC 返回前把精确档
 * 暖好」的实现在 v1.5.39 手动压缩清 `rule_snapshot` + `file_cache` 两域后变成
 * 全量冷组装（清单重评估 + 逐文件读盘 + inflate + 回填 deflate），挡在 IPC 返回前
 * 造成压缩按钮到 toast 卡顿数秒，故删除。
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
        // 机器码走 SCREAMING_SNAKE，与 `IpcErrorPayload.code` 家族其余成员一致
        //（同语义先例 `AGENT_BUSY`）。
        error: {
          code: "AGENT_RUN_IN_FLIGHT",
          message: "Agent 运行中无法压缩",
        },
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
    }
    return { ok: true, data: { ok: result.ok } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
