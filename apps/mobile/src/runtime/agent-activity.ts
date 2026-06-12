/**
 * 进程级 Agent 运行标记：备份/云同步等操作须在 Agent 空闲时执行。
 */

let agentActive = false;

type AgentActivityListener = (active: boolean) => void;

const listeners = new Set<AgentActivityListener>();

/**
 * 订阅 Agent 运行状态变化；返回取消订阅函数。
 */
export function subscribeMobileAgentActivity(
  listener: AgentActivityListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 聊天 Agent 回合进行中时置为 true。 */
export function setMobileAgentActive(active: boolean): void {
  if (agentActive === active) {
    return;
  }
  agentActive = active;
  for (const listener of listeners) {
    listener(active);
  }
}

/** Agent 是否正在运行（供 DB 备份与云同步守卫使用）。 */
export function isMobileAgentActive(): boolean {
  return agentActive;
}
