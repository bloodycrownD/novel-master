/**
 * Resolves display label for the workspace current agent pointer.
 */
import {resolveCurrentAgentId} from '@novel-master/core/agent';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

/** Display name for current agent; falls back to id or em dash when unset. */
export async function resolveCurrentAgentDisplayLabel(runtime: MobileNovelMasterRuntime): Promise<string> {
  const resolved = await resolveCurrentAgentId(runtime);
  // 已知失败与缺省同收「—」占位（错误通道迁移四期：resolve 沿 Result 回传，
  // 未知异常仍由调用方 refreshAgentLabel 的 catch 收口）。
  if (!resolved.ok) {
    return '—';
  }
  const agentId = resolved.value;
  if (agentId == null || agentId === '') {
    return '—';
  }
  const def = await runtime.agentRegistry.get(agentId);
  if (!def.ok) {
    return agentId;
  }
  const name = def.value.name?.trim();
  return name !== '' && name != null ? name : agentId;
}
