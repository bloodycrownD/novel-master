/**
 * Agent registry service port.
 *
 * @module service/agent/agent-registry.port
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { ValidateAgentDefinitionOptions } from "@/domain/agent/logic/validate-agent-definition.js";

/** Workspace agent registry (SQL-backed). */
export interface AgentRegistryService {
  listAgentIds(): Promise<readonly string[]>;
  /** 读取 prompts_json 解析后的 wire，行不存在返回 null（不解码）。 */
  getRawWire(agentId: string): Promise<unknown | null>;
  get(agentId: string): Promise<AgentDefinition>;
  upsert(
    agentId: string,
    def: AgentDefinition,
    options?: ValidateAgentDefinitionOptions,
  ): Promise<void>;
  /**
   * 删除指定 Agent。
   *
   * @remarks 工厂注入 {@link import("@/service/persistent-state/persistent-state.port.js").PersistentState} 且删除 id 为当前 Agent 时，会清空 `currentAgentId`。
   */
  delete(agentId: string): Promise<void>;
}