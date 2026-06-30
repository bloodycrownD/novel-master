/**
 * 进程级 Agent 运行引用计数：备份/云同步等操作须在 Agent 空闲时执行。
 * busy 由 main IPC 层 increment/decrement 独占；renderer 通过 IPC 订阅状态。
 */

let agentActiveRefCount = 0;

type AgentActivityListener = (active: boolean) => void;

const listeners = new Set<AgentActivityListener>();

function notifyListeners(active: boolean): void {
  for (const listener of listeners) {
    listener(active);
  }
}

/**
 * 订阅 Agent 运行状态变化；返回取消订阅函数。
 */
export function subscribeDesktopAgentActivity(
  listener: AgentActivityListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 回合开始前递增；同一 run 仅计一次。0→1 时通知订阅者。 */
export function incrementDesktopAgentActive(): void {
  const wasActive = agentActiveRefCount > 0;
  agentActiveRefCount += 1;
  if (!wasActive) {
    notifyListeners(true);
  }
}

/**
 * 回合结束（RUN_FINISHED/FAILED 或早退兜底）时递减；已归零时幂等忽略。
 * 1→0 时通知订阅者。
 */
export function decrementDesktopAgentActive(): void {
  if (agentActiveRefCount <= 0) {
    return;
  }
  agentActiveRefCount -= 1;
  if (agentActiveRefCount === 0) {
    notifyListeners(false);
  }
}

/** Agent 是否正在运行（供 run 门禁与 DB 备份/云同步守卫使用）。 */
export function isDesktopAgentActive(): boolean {
  return agentActiveRefCount > 0;
}
