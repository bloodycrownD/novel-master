/**
 * Chat header meta: current agent name + resolved model label (PRD D4).
 */
import {resolveApplicationModelId} from '@novel-master/core';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {resolveModelDisplayLabel} from '../provider/model-display-label';
import {
  resolveCurrentAgentDefinition,
  resolveCurrentAgentId,
} from './agent-run.service';

export interface ChatAgentMeta {
  readonly agentId: string | undefined;
  readonly agentName: string;
  readonly modelLabel: string;
  /** Agent has dedicated model pin (no workspace suffix). */
  readonly hasDedicatedModel: boolean;
}

export async function loadChatAgentMeta(
  runtime: MobileNovelMasterRuntime,
): Promise<ChatAgentMeta> {
  const agentId = await resolveCurrentAgentId(runtime);
  if (agentId == null) {
    return {
      agentId: undefined,
      agentName: '未配置 Agent',
      modelLabel: '—',
      hasDedicatedModel: false,
    };
  }

  try {
    const {definition} = await resolveCurrentAgentDefinition(runtime);
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
      if (!hasDedicatedModel) {
        modelLabel = `${modelLabel} · 工作区`;
      }
    }
    return {
      agentId,
      agentName: definition.name,
      modelLabel,
      hasDedicatedModel,
    };
  } catch {
    return {
      agentId,
      agentName: agentId,
      modelLabel: '—',
      hasDedicatedModel: false,
    };
  }
}
