/**
 * 用默认模板构建智能体定义（保留显示名称）。
 *
 * @module domain/agent/stored-config-validity/build-default-agent-definition
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";

/**
 * 用与「新建空白 Agent」相同的默认 prompts / runtime 构建定义，保留传入名称。
 * 名称经 trim；若为空由调用方 fallback 为 agentId。
 */
export function buildDefaultAgentDefinitionPreservingName(
  name: string
): AgentDefinition {
  return {
    name: name.trim(),
    // 表单层已迁出 core；此值等价 layoutFromFormInput(createDefaultAgentEditorPrompts())
    prompts: { persist: [], dynamic: [] },
    runtime: { maxSteps: 20 },
  };
}
