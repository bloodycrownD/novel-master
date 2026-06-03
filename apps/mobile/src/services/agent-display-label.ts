/**
 * Resolves display label for the workspace current agent pointer.
 */
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {resolveCurrentAgentId} from './agent-run.service';

/** Display name for current agent; falls back to id or em dash when unset. */
export async function resolveCurrentAgentDisplayLabel(
  runtime: MobileNovelMasterRuntime,
): Promise<string> {
  const agentId = await resolveCurrentAgentId(runtime);
  if (agentId == null || agentId === '') {
    return '—';
  }
  try {
    const def = await runtime.agentRegistry.get(agentId);
    const name = def.name?.trim();
    return name !== '' && name != null ? name : agentId;
  } catch {
    return agentId;
  }
}
