/**
 * Agent picker data + selection (shared by AgentPickerModal).
 */
import type {MobileNovelMasterRuntime} from '../runtime/types';

export const AGENT_PICKER_EMPTY_MESSAGE =
  '暂无智能体。请先在「智能体配置」中创建。';

export interface AgentPickerRow {
  readonly agentId: string;
  readonly label: string;
}

export async function loadAgentPickerRows(
  runtime: MobileNovelMasterRuntime,
): Promise<{rows: AgentPickerRow[]; currentId: string | undefined}> {
  const explicitId = await runtime.state.getCurrentAgentId();
  const currentId = explicitId ?? undefined;
  const ids = await runtime.agentRegistry.listAgentIds();
  const rows: AgentPickerRow[] = [];
  for (const agentId of ids) {
    let label = agentId;
    try {
      const def = await runtime.agentRegistry.get(agentId);
      label = def.name?.trim() || agentId;
    } catch {
      /* keep agentId */
    }
    rows.push({agentId, label});
  }
  return {rows, currentId};
}

export function isAgentPickerRowSelected(
  agentId: string,
  index: number,
  currentId: string | undefined,
): boolean {
  return agentId === currentId || (!currentId && index === 0);
}

/** Persists workspace current agent pointer. */
export async function selectWorkspaceAgent(
  runtime: MobileNovelMasterRuntime,
  agentId: string,
): Promise<void> {
  await runtime.state.setCurrentAgentId(agentId);
}

/**
 * 加载会话级 agent picker 行数据。
 *
 * 会话始终独立持有 agentId（core 已移除 workspace 回退层），
 * currentId 直接取 `sessionConfig.agentId`。
 */
export async function loadSessionAgentPickerRows(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
): Promise<{rows: AgentPickerRow[]; currentId: string | undefined}> {
  const sessionConfig = await runtime.sessions.getSessionAgentConfig(sessionId);
  const currentId = sessionConfig.agentId;
  const ids = await runtime.agentRegistry.listAgentIds();
  const rows: AgentPickerRow[] = [];
  for (const agentId of ids) {
    let label = agentId;
    try {
      const def = await runtime.agentRegistry.get(agentId);
      label = def.name?.trim() || agentId;
    } catch {
      /* keep agentId */
    }
    rows.push({agentId, label});
  }
  return {rows, currentId};
}

/**
 * 写入会话级 agent 引用（session.agentId）。
 *
 * 与 {@link selectWorkspaceAgent} 不同：这里只替换单个会话的 agentId，
 * 不动 workspace 全局指针。
 */
export async function selectSessionAgent(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  agentId: string,
): Promise<void> {
  await runtime.sessions.updateSessionAgentConfig(sessionId, {
    agentId,
  });
}

/**
 * 把会话 agentId 重置回 workspace 当前指针（放弃会话级独立引用，重新跟随全局）。
 *
 * core 已移除 workspace 回退层——会话 agentId 始终必填，所以「解绑」语义
 * 改为同步到 workspace 当前 agentId；workspace 无指针时不写避免覆盖。
 */
export async function clearSessionAgentBinding(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
): Promise<void> {
  const workspaceAgentId = await runtime.state.getCurrentAgentId();
  if (workspaceAgentId == null || workspaceAgentId === '') {
    return;
  }
  await runtime.sessions.updateSessionAgentConfig(sessionId, {
    agentId: workspaceAgentId,
  });
}
