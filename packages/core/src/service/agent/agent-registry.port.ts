/**
 * Agent registry service port.
 *
 * @module service/agent/agent-registry.port
 */

import type { AgentDefinition, AgentDefinitionPatch } from "@/domain/agent/model/agent-definition.js";
import type { ValidateAgentDefinitionOptions } from "@/domain/agent/logic/validate-agent-definition.js";

/** Workspace agent registry (SQL-backed). */
export interface AgentRegistryService {
  listAgentIds(): Promise<readonly string[]>;
  /**
   * 列出全部 agent 完整定义（含虚拟 seed `general`，DB 同名优先）。
   *
   * `task` 工具按 name 查询用；与 {@link get} 不同——`get(id)` 入参是 UUID，
   * 虚拟 general 没有 id，因此 `get` 不合并虚拟（保持现状，找不到报
   * `AGENT_NOT_FOUND`）。
   */
  list(): Promise<readonly AgentDefinition[]>;
  /** 读取 prompts_json 解析后的 wire，行不存在返回 null（不解码）。 */
  getRawWire(agentId: string): Promise<unknown | null>;
  get(agentId: string): Promise<AgentDefinition>;
  upsert(
    agentId: string,
    def: AgentDefinition,
    options?: ValidateAgentDefinitionOptions
  ): Promise<void>;
  /**
   * 按 RFC 7396 patch 更新已有 agent：读当前定义 → 合并 → 走 upsert 校验落库。
   *
   * 与 {@link upsert} 的区别是「部分更新」：patch 未提供的键保留现值、`null`
   * 清除字段；upsert 则是整份替换（编辑器保存 / 导入等全量场景用它）。
   * 返回合并后的定义（`name` 的 trim 由 upsert 内部完成）。
   */
  update(agentId: string, patch: AgentDefinitionPatch, options?: ValidateAgentDefinitionOptions): Promise<AgentDefinition>;
  /**
   * 删除指定 Agent。
   *
   * @remarks 工厂注入 {@link import("@/service/persistent-state/persistent-state.port.js").PersistentState} 且删除 id 为当前 Agent 时，会清空 `currentAgentId`。
   */
  delete(agentId: string): Promise<void>;
}
