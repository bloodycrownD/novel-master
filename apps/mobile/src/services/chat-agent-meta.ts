/**
 * Chat header meta: current agent name + resolved model label (PRD D4).
 */
import {resolveApplicationModelId} from '@novel-master/core/agent';
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
  /** Full prompt token estimate (e.g. `2.5K / 12K tokens`). */
  readonly tokenLabel: string;
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
      tokenLabel: '',
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
    }
    return {
      agentId,
      agentName: definition.name,
      modelLabel,
      tokenLabel: '',
      hasDedicatedModel,
    };
  } catch {
    return {
      agentId,
      agentName: agentId,
      modelLabel: '—',
      tokenLabel: '',
      hasDedicatedModel: false,
    };
  }
}
