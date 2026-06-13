/**
 * 为新建 Agent 分配最小未占用的 `agentN` 显示名。
 *
 * @module config-forms/agent/allocate-agent-display-name
 */

/** 已有 Agent 的 id 与显示名（decode 失败时可回退为 id）。 */
export type AgentDisplayNameSlot = {
  readonly id: string;
  readonly name: string;
};

/**
 * 返回 `agent1`、`agent2`… 中首个未被占用的显示名（trim 后精确匹配）。
 */
export function allocateAgentDisplayName(
  slots: readonly AgentDisplayNameSlot[],
): string {
  const used = new Set<string>();
  for (const slot of slots) {
    const trimmed = slot.name.trim();
    if (trimmed.length > 0) {
      used.add(trimmed);
    }
  }
  let n = 1;
  while (used.has(`agent${n}`)) {
    n += 1;
  }
  return `agent${n}`;
}
