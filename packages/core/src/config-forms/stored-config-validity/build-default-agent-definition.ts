/**
 * 用默认模板构建智能体定义（保留显示名称）。
 *
 * @module config-forms/stored-config-validity/build-default-agent-definition
 */

import {
  createDefaultAgentEditorPrompts,
  layoutFromFormInput,
} from "@/config-forms/agent/agent-editor-state.js";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";

/**
 * 用与「新建空白 Agent」相同的默认 prompts / runtime 构建定义，保留传入名称。
 * 名称经 trim；若为空由调用方 fallback 为 agentId。
 */
export function buildDefaultAgentDefinitionPreservingName(
  name: string,
): AgentDefinition {
  return {
    name: name.trim(),
    prompts: layoutFromFormInput(createDefaultAgentEditorPrompts()),
    runtime: { maxSteps: 20 },
  };
}
