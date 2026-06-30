/**
 * 进程级 Agent 运行引用计数：备份/云同步等操作须在 Agent 空闲时执行。
 */

let agentActiveRefCount = 0;

/** 回合开始前递增；同一 run 仅计一次。 */
export function incrementDesktopAgentActive(): void {
  agentActiveRefCount += 1;
}

/**
 * 回合结束（RUN_FINISHED/FAILED 或早退兜底）时递减；已归零时幂等忽略。
 */
export function decrementDesktopAgentActive(): void {
  if (agentActiveRefCount <= 0) {
    return;
  }
  agentActiveRefCount -= 1;
}

/** Agent 是否正在运行（供 run 门禁与 DB 备份/云同步守卫使用）。 */
export function isDesktopAgentActive(): boolean {
  return agentActiveRefCount > 0;
}
