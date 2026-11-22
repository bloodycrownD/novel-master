/**
 * Agent picker data + selection (shared by AgentPickerModal).
 */
import {Result, AppError} from '@novel-master/core/errors';
import {coreT} from '../i18n/core';
import type {MobileNovelMasterRuntime} from '../runtime/types';

export const AGENT_PICKER_EMPTY_MESSAGE = coreT({key: "ui.session.agent_picker_empty"});

export interface AgentPickerRow {
    readonly agentId: string;
    readonly label: string;
}

type AgentPickerRows = {
    rows: AgentPickerRow[];
    currentId: string | undefined;
};

export namespace AgentPicker {
    async function loadAgentRows(runtime: MobileNovelMasterRuntime): Promise<AgentPickerRow[]> {
        const ids = await runtime.agentRegistry.listAgentIds();
        const rows: AgentPickerRow[] = [];
        for (const agentId of ids) {
            let label = agentId;
            const def = await runtime.agentRegistry.get(agentId);
            if (def.ok) {
                if (def.value.mode === 'subagent') {
                    continue;
                }
                label = def.value.name?.trim() || agentId;
            }
            rows.push({agentId, label});
        }
        return rows;
    }

    /** 失败沿 `Result.err` 接力（错误通道迁移四期），调用方弹窗 formatError 收口。 */
    export async function loadRows(runtime: MobileNovelMasterRuntime): Promise<Result<AgentPickerRows, AppError>> {
        const explicitId = await runtime.state.getCurrentAgentId();
        if (!explicitId.ok) return Result.err(explicitId.error);
        const currentId = explicitId.value ?? undefined;
        const rows = await loadAgentRows(runtime);
        return Result.ok({rows, currentId});
    }

    export function isRowSelected(agentId: string, index: number, currentId: string | undefined): boolean {
        return agentId === currentId || (!currentId && index === 0);
    }

    /** Persists workspace current agent pointer. */
    export async function selectWorkspace(runtime: MobileNovelMasterRuntime, agentId: string): Promise<void> {
        await runtime.state.setCurrentAgentId(agentId);
    }

    /**
   * 加载会话级 agent picker 行数据。
   *
   * 会话始终独立持有 agentId（core 已移除 workspace 回退层），
   * currentId 直接取 `sessionConfig.agentId`。
   * 失败沿 `Result.err` 接力（错误通道迁移四期），调用方弹窗 formatError 收口。
   */
    export async function loadSessionRows(runtime: MobileNovelMasterRuntime, sessionId: string): Promise<Result<AgentPickerRows, AppError>> {
        const sessionConfig = await runtime.sessions.getSessionAgentConfig(sessionId);
        if (!sessionConfig.ok) return Result.err(sessionConfig.error);
        const currentId = sessionConfig.value.agentId;
        const rows = await loadAgentRows(runtime);
        return Result.ok({rows, currentId});
    }

    /**
   * 写入会话级 agent 引用（session.agentId）。
   *
   * 与 {@link selectWorkspace} 不同：这里只替换单个会话的 agentId，
   * 不动 workspace 全局指针。
   */
    export async function selectSession(runtime: MobileNovelMasterRuntime, sessionId: string, agentId: string): Promise<void> {
        await runtime.sessions.updateSessionAgentConfig(sessionId, {
            agentId,
        });
    }
}
