/**
 * Chat header meta: current agent name + resolved model label (PRD D4).
 */
import {
  AgentRunResolveError,
  resolveAgentForProject,
  resolveApplicationModelId,
} from '@novel-master/core/agent';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {resolveModelDisplayLabel} from '../provider/model-display-label';

export interface ChatAgentMeta {
  readonly source: 'global' | 'project-custom' | 'none';
  readonly agentId: string | undefined;
  readonly agentName: string;
  readonly modelLabel: string;
  /** Full prompt token estimate (e.g. `2.5K / 12K tokens`). */
  readonly tokenLabel: string;
  /** Agent has dedicated model pin (no workspace suffix). */
  readonly hasDedicatedModel: boolean;
}

/** 按项目解析 Agent 元信息；custom 模式不含 agentId。 */
export async function loadChatAgentMeta(
  runtime: MobileNovelMasterRuntime,
  projectId: string,
): Promise<ChatAgentMeta> {
  try {
    const resolved = await resolveAgentForProject(runtime, projectId);
    const {definition} = resolved;
    const hasDedicatedModel =
      definition.model != null && definition.model !== '';
    const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? '';
    const applicationModelId = resolveApplicationModelId({
      agentModelId: definition.model,
      workspaceModelId: workspaceModelId || undefined,
    });
    let modelLabel = '未选择模型';
    if (applicationModelId) {
      try {
        modelLabel = await resolveModelDisplayLabel(
          runtime,
          applicationModelId,
        );
      } catch {
        modelLabel = applicationModelId;
      }
    }
    if (resolved.source === 'global') {
      return {
        source: 'global',
        agentId: resolved.agentId,
        agentName: definition.name,
        modelLabel,
        tokenLabel: '',
        hasDedicatedModel,
      };
    }
    return {
      source: 'project-custom',
      agentId: undefined,
      agentName: definition.name,
      modelLabel,
      tokenLabel: '',
      hasDedicatedModel,
    };
  } catch (error) {
    if (error instanceof AgentRunResolveError) {
      return {
        source: 'none',
        agentId: undefined,
        agentName: '未配置 Agent',
        modelLabel: '—',
        tokenLabel: '',
        hasDedicatedModel: false,
      };
    }
    throw error;
  }
}
