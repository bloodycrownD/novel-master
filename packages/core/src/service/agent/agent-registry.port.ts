/**
 * Agent registry service port.
 *
 * @module service/agent/agent-registry.port
 */

import type { AgentDefinition, AgentDefinitionPatch } from "@/domain/agent/model/agent-definition.js";
import type { ValidateAgentDefinitionOptions } from "@/domain/agent/logic/validate-agent-definition.js";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

/** Workspace agent registry (SQL-backed). */
export interface AgentRegistryService {
    listAgentIds(): Promise<readonly string[]>;
    /**
   * 列出全部 agent 完整定义（含虚拟 seed `general`，DB 同名优先）。
   *
   * `task` 工具按 name 查询用；与 {@link get} 不同——`get(id)` 入参是 UUID，
   * 虚拟 general 没有 id，因此 `get` 不合并虚拟（保持现状，找不到报
   * `AGENT_NOT_FOUND`）。
   *
   * 已知失败走返回值（五期门⑦）：repository 毒行 decode 失败收 `Result.err`
   * （一行坏、全列表失败，与旧 throw 契约等价）。
   */
    list(): Promise<Result<readonly AgentDefinition[], AppError>>;
    /** 读取 prompts_json 解析后的 wire，行不存在返回 null（不解码）。 */
    getRawWire(agentId: string): Promise<unknown | null>;
    /**
   * 已知失败走返回值（五期门⑦）：id 不存在收 `Result.err(AGENT_NOT_FOUND)`；
   * repository 层未知异常仍抛，由边界统一收口。
   */
    get(agentId: string): Promise<Result<AgentDefinition, AppError>>;
    /**
   * 已知失败走返回值（四期门⑦）：schema / 校验 / 重名等域校验失败收
   * `Result.err`；repository 层未知异常仍抛，由边界统一收口。
   */
    upsert(agentId: string, def: AgentDefinition, options?: ValidateAgentDefinitionOptions): Promise<Result<void, AppError>>;
    /**
   * 按 RFC 7396 patch 更新已有 agent：读当前定义 → 合并 → 走 upsert 校验落库。
   *
   * 与 {@link upsert} 的区别是「部分更新」：patch 未提供的键保留现值、`null`
   * 清除字段；upsert 则是整份替换（编辑器保存 / 导入等全量场景用它）。
   * 返回合并后的定义（`name` 的 trim 由 upsert 内部完成）。
   */
    update(agentId: string, patch: AgentDefinitionPatch, options?: ValidateAgentDefinitionOptions): Promise<Result<AgentDefinition, AppError>>;
    /**
   * 删除指定 Agent。
   *
   * 已知失败走返回值（五期门⑦）：id 不存在收 `Result.err(AGENT_NOT_FOUND)`，
   * 内置 general 不可删收 `Result.err(AGENT_INVALID_SCHEMA)`；repository 层
   * 未知异常仍抛，由边界统一收口。
   *
   * @remarks 工厂注入 {@link import("@/service/persistent-state/persistent-state.port.js").PersistentState} 且删除 id 为当前 Agent 时，会清空 `currentAgentId`。
   */
    delete(agentId: string): Promise<Result<void, AppError>>;
}
