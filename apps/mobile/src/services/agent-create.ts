/**
 * Creates a blank agent in the registry (shared by Agents settings screen).
 */
import {AgentEditorState, AllocateAgentDisplayName, type AgentMode} from '@/config-forms/agent';
import {AppError, Result} from '@novel-master/core/errors';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

export namespace AgentCreate {
  /**
   * Creates blank agent in registry; returns new agentId（已知失败沿
   * `Result.err` 上行，四期门⑦；屏幕按 Err 分支 toast）。
   *
   * `mode` 传入时作为新定义的默认作用域直接落库（主 tab → "primary"、
   * 子 tab → "subagent"）；不传则维持既有行为（缺省 all，双侧可见）。
   */
  // nm-style: keep-local — 导出签名（3 参 + runtime 长类型 + 模板默认值）单行化超 80 列
  export async function createBlank(runtime: MobileNovelMasterRuntime, id = `agent-${Date.now()}`, mode?: AgentMode): Promise<Result<string, AppError>> {
    const ids = await runtime.agentRegistry.listAgentIds();
    const slots = [];
    for (const id of ids) {
      const def = await runtime.agentRegistry.get(id);
      slots.push(def.ok ? {id, name: def.value.name} : {id, name: id});
    }
    const name = AllocateAgentDisplayName.allocate(slots);
    const definition = {name, ...(mode != null ? {mode} : {}), runtime: {maxSteps: 20}, prompts: AgentEditorState.layoutFromFormInput(AgentEditorState.createDefaultAgentEditorPrompts())};
    const saved = await runtime.agentRegistry.upsert(id, definition);
    if (!saved.ok) return Result.err(saved.error);
    return Result.ok(id);
  }
}
