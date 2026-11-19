/**
 * Resolves display label for the workspace current agent pointer.
 */
import {AgentRunShared} from '@novel-master/core/agent';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

/** Display name for current agent; falls back to id or em dash when unset. */
// nm-style: keep-public — token-usage-stats-screen.test.tsx 以 jest.mock 模块接缝拦截（resolveCurrentAgentDisplayLabel: jest.fn），内联会使 mock 失效
export async function resolveCurrentAgentDisplayLabel(runtime: MobileNovelMasterRuntime): Promise<string> {
  const resolved = await AgentRunShared.resolveCurrentId(runtime);
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
