/**
 * 进程级 Agent 运行标记（引用计数）：备份/云同步等操作须在 Agent 空闲时执行。
 * busy 由平台层 increment/decrement 独占管理；renderer hook 不得直接改计数。
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
export function subscribeMobileAgentActivity(
  listener: AgentActivityListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Agent 回合开始时递增引用计数；0→1 时通知订阅者。 */
export function incrementAgentActive(): void {
  const wasActive = agentActiveRefCount > 0;
  agentActiveRefCount += 1;
  if (!wasActive) {
    notifyListeners(true);
  }
}

/**
 * Agent 回合结束时递减引用计数；1→0 时通知订阅者。
 * 计数已为 0 时幂等忽略，避免 FINISHED 与 finally 双减。
 */
export function decrementAgentActive(): void {
  if (agentActiveRefCount <= 0) {
    return;
  }
  agentActiveRefCount -= 1;
  if (agentActiveRefCount === 0) {
    notifyListeners(false);
  }
}

/** Agent 是否正在运行（供门禁、DB 备份与云同步守卫使用）。 */
export function isMobileAgentActive(): boolean {
  return agentActiveRefCount > 0;
}

/**
 * @deprecated 请改用 incrementAgentActive / decrementAgentActive。
 * 迁移期兼容：直接覆盖为布尔状态（置 true 时计数归 1，置 false 时归 0）。
 */
export function setMobileAgentActive(active: boolean): void {
  const wasActive = agentActiveRefCount > 0;
  agentActiveRefCount = active ? 1 : 0;
  if (wasActive !== active) {
    notifyListeners(active);
  }
}
