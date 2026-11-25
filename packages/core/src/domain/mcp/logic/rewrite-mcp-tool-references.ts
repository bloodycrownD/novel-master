/**
 * MCP 工具引用改写（换 ID 联动）：agent 工具白/黑名单里 `mcp__<ID>__<tool>`
 * 注册名的服务器段改写到新 ID。`mcp__` / `__` 框架段自带边界，前缀替换不会
 * 误伤其它服务器的条目；注册名超长被截断 + 短哈希时，ID 段（用户填的短标识）
 * 落在保留前缀内，同样命中。
 *
 * @module domain/mcp/logic/rewrite-mcp-tool-references
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { McpServerConfig } from "../model/mcp-server-config.js";
import type { McpConfigStore, McpRenameOutcome } from "../ports/mcp-config-store.port.js";

/** 换 ID 改写的最窄 registry 接缝（core `AgentRegistryService` 的读 + 写子集）。 */
export interface AgentToolRefRegistry {
    listAgentIds(): Promise<readonly string[]>;
    get(agentId: string): Promise<Result<AgentDefinition, AppError>>;
    upsert(agentId: string, def: AgentDefinition): Promise<Result<void, AppError>>;
}

/** 换 ID 编排的依赖：配置存储 + agent 注册表。 */
export interface McpToolRefDeps {
    readonly configStore: McpConfigStore;
    readonly agentRegistry: AgentToolRefRegistry;
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
     * registry 全量改写：白/黑名单命中的 agent upsert 写回，无命中的 agent 不写回
     * （幂等——反向调用即回滚）。任一 agent 写回失败即返回 err（带 agentId）。
     */
    rewriteAgentTools: async (registry: AgentToolRefRegistry, oldId: string, newId: string): Promise<Result<void, AppError>> => {
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
            if (!saved.ok) return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: `MCP 工具引用改写失败（${agentId}）: ${saved.error.message}` }));
        }
        return Result.ok(undefined);
    },

    /**
     * 换 ID 的双端共用编排：改写 agent 工具引用 → `store.rename` → `afterRename`（调用方写用户新填的
     * bearer 等收尾）。任一步失败就反向改写；配置已经改名过的再按旧配置迁回——不留「引用已改、
     * 配置或密钥改了一半」的状态。回滚自身尽力而为（各步幂等）。`oldId === config.id` 时只是普通保存。
     */
    renameWithRewrite: async (deps: McpToolRefDeps, oldId: string, config: McpServerConfig, afterRename?: () => Promise<void>): Promise<Result<McpRenameOutcome, AppError>> => {
        const { agentRegistry, configStore } = deps;
        if (oldId === config.id) {
            const saved = await configStore.save(config);
            return saved.ok ? Result.ok({ oauthMigrated: true }) : Result.err(saved.error);
        }
        const listed = await configStore.list();
        if (!listed.ok) return Result.err(listed.error);
        const previous = listed.value.find((server) => server.id === oldId);
        const rewritten = await McpToolRefs.rewriteAgentTools(agentRegistry, oldId, config.id);
        if (!rewritten.ok) return Result.err(rewritten.error);
        let renamed = false;
        // 新 ID 与别的 server 撞名时 store.rename 没有动过配置，只改回引用——否则会把同名的那个 server 覆盖掉。
        const rollback = async (): Promise<void> => {
            await McpToolRefs.rewriteAgentTools(agentRegistry, config.id, oldId);
            if (renamed && previous != null) await configStore.rename(config.id, previous);
        };
        try {
            const outcome = await configStore.rename(oldId, config);
            if (!outcome.ok) {
                await rollback();
                return Result.err(outcome.error);
            }
            renamed = true;
            if (afterRename != null) await afterRename();
            return Result.ok(outcome.value);
        } catch (cause: unknown) {
            await rollback().catch(() => undefined);
            return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: cause instanceof Error ? cause.message : String(cause) }));
        }
    },
} as const;
