/**
 * Shared agent-run resolve helpers for mobile and desktop runtimes.
 *
 * @module service/agent/logic/agent-run-shared
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { SessionAgentConfig } from "@/domain/chat/model/session-agent-config.js";
import { AppError, AppErrorOps } from "@/errors/app-error.js";
import type { ErrorKey } from "@/errors/error-codes.js";
import { Result } from "@/errors/either.js";

/**
 * Agent run 共享的最小 runtime 表面。
 *
 * `sessions` 用来读会话级智能体配置（`SessionAgentConfig`），service 层保证
 * 列 NULL 已被 migration 回填，调用方拿到的永远是规范化后的对象（会话不存在
 * 走 `Result.err`，NULL 不变量破坏仍 throw）。
 */
export interface AgentRunRuntimePort {
    readonly state: {
        getCurrentAgentId(): Promise<Result<string | undefined, AppError>>;
        getCurrentModelId(): Promise<Result<string | undefined, AppError>>;
    };
    readonly agentRegistry: {
        listAgentIds(): Promise<readonly string[]>;
        get(agentId: string): Promise<Result<AgentDefinition, AppError>>;
    };
    readonly sessions: {
        getSessionAgentConfig(id: string): Promise<Result<SessionAgentConfig, AppError>>;
    };
}

/**
 * agent run resolve 链的失败形态（AgentRunResolveError 退役后的判别集合）：
 * 核心侧 {@link AgentRunShared.resolveCurrentDefinition} / {@link AgentRunShared.resolveApplicationModelIdForRun} /
 * `resolveAgentForProject` 与双端 mapResolveError、meta 归一 catch 共用同一口径。
 */
export const AGENT_RUN_RESOLVE_KEYS: ReadonlySet<ErrorKey> = new Set<ErrorKey>(["AGENT_NOT_CONFIGURED", "AGENT_NOT_FOUND", "AGENT_MODEL_NOT_SET", "AGENT_REFERENCED_NOT_FOUND"]);

/** Agent run 共享的 resolve 语义集合（mobile / desktop runtime 共用）。 */
export const AgentRunShared = {
    /** Resolves current agent id from state or registry fallback；state 读取失败沿 `Result.err` 回传。 */
    async resolveCurrentId(runtime: AgentRunRuntimePort): Promise<Result<string | undefined, AppError>> {
        const fromState = await runtime.state.getCurrentAgentId();
        if (!fromState.ok) return Result.err(fromState.error);
        if (fromState.value != null && fromState.value !== "") {
            return Result.ok(fromState.value);
        }
        const ids = await runtime.agentRegistry.listAgentIds();
        return Result.ok(ids[0]);
    },

    /**
   * 新建会话时解析 workspace 当前 agentId：state 优先，缺失时回落 registry 首项。
   *
   * 与 {@link resolveCurrentId} 同语义，只是入参收窄为 session service 实际
   * 持有的 `{ state, agentRegistry }` 形状（不强制要求 sessions 字段）。
   */
    // nm-style: keep-local — 唯一调用点在 service/chat/impl/session.service.ts（本片范围外），内联需跨目录改调用方；保留为 agent-run 共享的 resolve 语义单一入口。
    async resolveWorkspaceForNewSession(deps: {
        readonly state: {
            getCurrentAgentId(): Promise<Result<string | undefined, AppError>>;
        };
        readonly agentRegistry: {
            listAgentIds(): Promise<readonly string[]>;
        };
    }): Promise<Result<string | undefined, AppError>> {
        const fromState = await deps.state.getCurrentAgentId();
        if (!fromState.ok) return Result.err(fromState.error);
        if (fromState.value != null && fromState.value !== "") {
            return Result.ok(fromState.value);
        }
        const ids = await deps.agentRegistry.listAgentIds();
        return Result.ok(ids[0]);
    },

    /** Loads agent definition for the current agent pointer；未配置/找不到 agent 沿 `Result.err` 回传（repository 未知异常仍走 throw 通道）。 */
    async resolveCurrentDefinition(runtime: AgentRunRuntimePort): Promise<Result<{ agentId: string; definition: AgentDefinition }, AppError>> {
        const resolvedId = await AgentRunShared.resolveCurrentId(runtime);
        if (!resolvedId.ok) return Result.err(resolvedId.error);
        const agentId = resolvedId.value;
        if (agentId == null || agentId === "") {
            return Result.err(new AppError("AGENT_NOT_CONFIGURED"));
        }
        const definition = await runtime.agentRegistry.get(agentId);
        if (!definition.ok) {
            if (AppErrorOps.is(definition.error, "AGENT_NOT_FOUND")) {
                return Result.err(new AppError("AGENT_NOT_FOUND", { agentId }));
            }
            return Result.err(definition.error);
        }
        return Result.ok({ agentId, definition: definition.value });
    },

    /**
   * 解析对话 Agent 的 savedModelId（agent pin → session 覆盖）。
   *
   * workspace 层已移除：不再从 state.getCurrentModelId() 回退。返回的
   * `workspaceModelId` 仅用于下游压缩评估等消费方，由 state 读取后透传，
   * 不参与 savedModelId 解析优先级。
   * 五期门⑦：state / sessions 的 `Result` 失败与「模型未设置」沿 `Result.err` 回传，
   * 由 turn loop（mapResolveError）/ 调用端点收口。
   */
    async resolveApplicationModelIdForRun(runtime: AgentRunRuntimePort, definition: AgentDefinition, sessionId?: string): Promise<Result<ResolvedRunModelIds, AppError>> {
        const currentModel = await runtime.state.getCurrentModelId();
        if (!currentModel.ok) return Result.err(currentModel.error);
        const workspaceModelId = currentModel.value ?? "";
        let sessionModelId: string | undefined;
        if (sessionId != null && sessionId !== "") {
            const sessionConfig = await runtime.sessions.getSessionAgentConfig(sessionId);
            if (!sessionConfig.ok) return Result.err(sessionConfig.error);
            // modelId 可选；空串归一化为 undefined（与 workspaceModelId 同约束）
            sessionModelId = sessionConfig.value.modelId || undefined;
        }
        const resolved = definition.model ?? sessionModelId;
        if (resolved == null || resolved === "") {
            return Result.err(new AppError("AGENT_MODEL_NOT_SET"));
        }
        return Result.ok({ savedModelId: resolved, workspaceModelId });
    },
} as const;

/** {@link AgentRunShared.resolveApplicationModelIdForRun} 的解析结果：savedModelId 参与请求，workspaceModelId 供压缩评估透传。 */
type ResolvedRunModelIds = { savedModelId: string; workspaceModelId: string };
