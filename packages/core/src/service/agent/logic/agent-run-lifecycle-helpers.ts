/**
 * Agent run 生命周期纯函数：desktop useAgentRunLifecycle 消费
 * （mobile 已不走这套守卫，见 apps/mobile 的 manager 自有 settle 状态机）。
 */

/**
 * 「已受理、RUN_STARTED 还没到」的占位 runId（r3-run-1 步骤 4）。
 *
 * core 前奏期（backfill / 校验 / 名单 / 技能装配，秒级窗口）不发 RUN_STARTED，
 * 只在收尾时补一条 `runId: ''` 的 FINISHED/FAILED。renderer 这边 beginUiRun
 * 之后 activeRunId 一直是 null，于是那条空串终态会被
 * {@link shouldAcceptRunEvent} 以「activeRunId 为空」拒掉 → uiRunning 永久
 * true、abort 冻结永久挂起。beginUiRun 同步把 ref 置成这个哨兵值，就为放行
 * 这一种形态。
 *
 * 用哨兵字符串而不是「放行所有空串」：空串终态只有在「本会话当前 run 仍在
 * 受理中」时才可信，哨兵值让这个前提变得可判（activeRunId === PENDING_RUN_ID
 * 蕴含「刚 begin、还没等到 RUN_STARTED」）。真正的 RUN_STARTED 到达后
 * onRunStarted 立即用真实 runId 覆盖它。
 */
export const PENDING_RUN_ID = "__pending__" as const;

/** 是否接受带 runId 的 stream/bus 事件。 */
export function shouldAcceptRunEvent(
  activeRunId: string | null,
  runId: string | undefined
): boolean {
  // 前奏终态（runId === ''）：只在受理哨兵态下放行（见 PENDING_RUN_ID 注释）。
  // 这里的顺序不能调换——空串终态必须先于「空串一律拒绝」判据被接住。
  if (runId === "") {
    return activeRunId === PENDING_RUN_ID;
  }
  if (runId == null) {
    return false;
  }
  if (activeRunId == null) {
    return false;
  }
  return activeRunId === runId;
}

/** abort 后迟到 RUN_STARTED 是否应被忽略。 */
export function shouldIgnoreStaleRunStarted(
  uiRunning: boolean,
  _activeRunId: string | null
): boolean {
  return !uiRunning;
}

/** STEP/FINISHED 是否允许触发增列表的 transcript reload。 */
export function shouldReloadTranscriptOnRunEvent(uiRunning: boolean): boolean {
  return uiRunning;
}

export type ShouldApplyTranscriptReloadOptions = {
  readonly abortRetainPending?: boolean;
  readonly phase?: "assistant" | "tool_results";
};

/** STEP/FINISHED/FAILED 是否允许增列表 reload（uiRunning + freeze 双保险；abort retain 一次例外）。 */
export function shouldApplyTranscriptReload(
  uiRunning: boolean,
  freezeCount: number | null,
  opts?: ShouldApplyTranscriptReloadOptions
): boolean {
  if (opts?.abortRetainPending === true && opts.phase === "assistant") {
    return true;
  }
  if (!shouldReloadTranscriptOnRunEvent(uiRunning)) {
    return false;
  }
  if (freezeCount != null) {
    return false;
  }
  return true;
}
