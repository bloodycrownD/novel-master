/**
 * Agent definition repository port.
 *
 * @module domain/agent/repositories/agent-definition.port
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { AgentDefinition } from "../model/agent-definition.js";

/** Persistence for workspace agent definitions. */
export interface AgentDefinitionRepository {
    listIds(): Promise<readonly string[]>;
    /**
   * 列出全部 agent 完整定义（仅 DB 行，不含虚拟 seed）。
   *
   * 已知失败走返回值（五期门⑦）：毒行 decode 失败收 `Result.err`（一行坏，
   * 全列表失败，与旧 throw 契约等价）；DB 层未知异常仍抛，由边界统一收口。
   */
    list(): Promise<Result<readonly AgentDefinition[], AppError>>;
    /**
   * 已知失败走返回值（五期门⑦）：毒行 decode 失败收 `Result.err`；
   * 行不存在收 `Result.ok(null)`；DB 层未知异常仍抛，由边界统一收口。
   */
    get(agentId: string): Promise<Result<AgentDefinition | null, AppError>>;
    /** 读取 prompts_json 解析后的 wire 对象，行不存在返回 null。 */
    getRawWire(agentId: string): Promise<unknown | null>;
    /** 仅检查行是否存在，不解码 prompts_json。 */
    exists(agentId: string): Promise<boolean>;
    /**
   * 已知失败走返回值（五期门⑦）：toWire 门禁失败（块名唯一性等）收
   * `Result.err`；DB 层未知异常仍抛，由边界统一收口。
   */
    upsert(agentId: string, def: AgentDefinition): Promise<Result<void, AppError>>;
    delete(agentId: string): Promise<void>;
}
