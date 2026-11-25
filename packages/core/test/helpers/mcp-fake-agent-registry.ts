import type { AgentDefinition } from "../../src/domain/agent/model/agent-definition.js";
import type { AgentToolRefRegistry } from "../../src/domain/mcp/logic/rewrite-mcp-tool-references.js";
import { AppError } from "../../src/errors/app-error.js";
import { Result } from "../../src/errors/either.js";

/** 内存 fake registry：defs 是 agent 定义的存储；failNext 注入下一次 upsert 失败。 */
export function fakeMcpAgentRegistry(initial: Record<string, AgentDefinition>): AgentToolRefRegistry & { readonly defs: Map<string, AgentDefinition>; readonly upserted: string[]; failNext(): void } {
    const defs = new Map(Object.entries(initial));
    const upserted: string[] = [];
    let failing = false;
    return {
        defs,
        upserted,
        failNext: () => {
            failing = true;
        },
        listAgentIds: async () => [...defs.keys()],
        get: async (agentId) => Result.ok(defs.get(agentId) ?? { name: agentId, prompts: { persist: [], dynamic: [] } }),
        upsert: async (agentId, def) => {
            if (failing) {
                failing = false;
                return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: "injected upsert failure" }));
            }
            upserted.push(agentId);
            defs.set(agentId, def);
            return Result.ok(undefined);
        },
    };
}
