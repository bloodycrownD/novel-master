/**
 * Creates a blank agent in the registry (shared by Agents settings screen).
 */
import {
  allocateAgentDisplayName,
  createDefaultAgentEditorPrompts,
  layoutFromFormInput,
  type AgentMode,
} from '@/config-forms/agent';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

/**
 * Creates blank agent in registry; returns new agentId.
 *
 * `mode` 传入时作为新定义的默认作用域直接落库（主 tab → "primary"、
 * 子 tab → "subagent"）；不传则维持既有行为（缺省 all，双侧可见）。
 */
// nm-style: keep-local — 导出签名（3 参 + runtime 长类型 + 模板默认值）单行化超 80 列
export async function createBlankAgent(
  runtime: MobileNovelMasterRuntime,
  id = `agent-${Date.now()}`,
  mode?: AgentMode,
): Promise<string> {
  const ids = await runtime.agentRegistry.listAgentIds();
  const slots = [];
  for (const id of ids) {
    try {
      const def = await runtime.agentRegistry.get(id);
      slots.push({id, name: def.name});
    } catch {
      slots.push({id, name: id});
    }
  }
  const name = allocateAgentDisplayName(slots);
  await runtime.agentRegistry.upsert(id, {
    name,
    ...(mode != null ? {mode} : {}),
    runtime: {maxSteps: 20},
    prompts: layoutFromFormInput(createDefaultAgentEditorPrompts()),
  });
  return id;
}
