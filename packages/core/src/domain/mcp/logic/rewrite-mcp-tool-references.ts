/**
 * MCP 工具引用改写（换 ID 联动）：agent 工具白/黑名单里 `mcp__<ID>__<tool>`
 * 注册名的服务器段改写到新 ID。`mcp__` / `__` 框架段自带边界，前缀替换不会
 * 误伤其它服务器的条目；注册名超长被截断 + 短哈希时，ID 段（用户填的短标识）
 * 落在保留前缀内，同样命中。
 *
 * @module domain/mcp/logic/rewrite-mcp-tool-references
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";

/** 换 ID 改写的最窄 registry 接缝（core `AgentRegistryService` 的读 + 写子集）。 */
interface AgentToolRefRegistry {
    listAgentIds(): Promise<readonly string[]>;
    get(agentId: string): Promise<Result<AgentDefinition, AppError>>;
    upsert(agentId: string, def: AgentDefinition): Promise<Result<void, AppError>>;
}

/** 名单里 `mcp__<oldId>__` 前缀的条目改写到新 ID，其余原样；无命中时返回原数组引用。 */
export const McpToolRefs = {
    rewriteNames: (names: readonly string[], oldId: string, newId: string): readonly string[] => {
        const from = `mcp__${oldId}__`;
        const to = `mcp__${newId}__`;
        if (!names.some((name) => name.startsWith(from))) return names;
        return names.map((name) => (name.startsWith(from) ? `${to}${name.slice(from.length)}` : name));
    },

    /**
     * registry 全量改写（换 ID 的双端共用编排）：白/黑名单命中的 agent upsert 写回，
     * 无命中的 agent 不写回（幂等——反向调用即回滚）。upsert 失败以 throw 冒出，
     * 错误信息带 agentId、由调用方（换 ID 编排）回滚后收口。
     */
    rewriteAgentTools: async (registry: AgentToolRefRegistry, oldId: string, newId: string): Promise<void> => {
        for (const agentId of await registry.listAgentIds()) {
            const got = await registry.get(agentId);
            if (!got.ok) continue;
            const def = got.value;
            const allow = def.tools?.allow;
            const deny = def.tools?.deny;
            const nextAllow = allow != null ? McpToolRefs.rewriteNames(allow, oldId, newId) : allow;
            const nextDeny = deny != null ? McpToolRefs.rewriteNames(deny, oldId, newId) : deny;
            if (nextAllow === allow && nextDeny === deny) continue;
            const tools = { ...(nextAllow != null ? { allow: [...nextAllow] } : {}), ...(nextDeny != null ? { deny: [...nextDeny] } : {}) };
            const saved = await registry.upsert(agentId, { ...def, tools });
            // nm-throw: keep — 编排契约：改写失败原样上抛，由换 ID 编排方（desktop IPC / mobile mirror）回滚后在其边界收口
            if (!saved.ok) throw new Error(`MCP 工具引用改写失败（${agentId}）: ${saved.error.message}`);
        }
    },
} as const;
