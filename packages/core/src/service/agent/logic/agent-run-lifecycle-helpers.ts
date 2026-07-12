/**
 * Agent run 生命周期纯函数：双端 useAgentRunLifecycle 共用。
 */

/** 是否接受带 runId 的 stream/bus 事件。 */
export function shouldAcceptRunEvent(
  activeRunId: string | null,
  runId: string | undefined,
): boolean {
  if (runId == null || runId === '') {
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
  _activeRunId: string | null,
): boolean {
  return !uiRunning;
}

/** STEP/FINISHED 是否允许触发增列表的 transcript reload。 */
export function shouldReloadTranscriptOnRunEvent(uiRunning: boolean): boolean {
  return uiRunning;
}
