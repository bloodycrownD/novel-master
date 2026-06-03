/**
 * Agent picker data + selection (shared by AgentPickerModal).
 */
import type {MobileNovelMasterRuntime} from '../runtime/types';

export const AGENT_PICKER_EMPTY_MESSAGE =
  '暂无 Agent。请先在「agent管理」中创建。';

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
