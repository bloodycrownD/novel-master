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
 * `currentId` 取值优先级：会话 bind 的 agentId > 会话 follow 时回退 workspace 当前 agent。
 * 这样 UI 上选中态能正确反映「会话绑定优先，否则跟随全局」的语义。
 */
export async function loadSessionAgentPickerRows(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
): Promise<{rows: AgentPickerRow[]; currentId: string | undefined}> {
  const sessionConfig = await runtime.sessions.getSessionAgentConfig(sessionId);
  const workspaceCurrentId = await runtime.state.getCurrentAgentId();
  const currentId =
    sessionConfig.mode === 'bind' && sessionConfig.agentId
      ? sessionConfig.agentId
      : (workspaceCurrentId ?? undefined);
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
 * 写入会话级 agent 绑定（mode=bind + agentId）。
 *
 * 与 {@link selectWorkspaceAgent} 不同：这里只影响单个会话，不动 workspace 全局指针。
 */
export async function selectSessionAgent(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  agentId: string,
): Promise<void> {
  await runtime.sessions.updateSessionAgentConfig(sessionId, {
    mode: 'bind',
    agentId,
  });
}

/**
 * 解除会话级 agent 绑定（回到 follow，跟随 workspace 全局）。
 */
export async function clearSessionAgentBinding(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
): Promise<void> {
  await runtime.sessions.updateSessionAgentConfig(sessionId, {
    mode: 'follow',
  });
}
