/**
 * Chat header meta: current agent name + resolved model label (PRD D4)。
 *
 * source 用于区分 agent 来源（workspace 全局 / 会话级绑定 / 项目自定义）。
 * modelSource 用于区分生效模型来源（agent pin / 会话覆盖 / workspace）。
 */
import {
  AgentRunResolveError,
  resolveAgentForProject,
  resolveApplicationModelId,
} from '@novel-master/core/agent';
import {PROJECT_AGENT_META_DISPLAY_LABEL} from '@novel-master/core/chat';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {resolveModelDisplayLabel} from '../provider/model-display-label';

/** modelSource 与 desktop `PromptAgentMetaResponse.modelSource` 同语义（不含 desktop 独有的 'cli'）。 */
export type ChatAgentModelSource = 'agent-pin' | 'session-override' | 'workspace';

export interface ChatAgentMeta {
  readonly source: 'global' | 'project-custom' | 'session-bind' | 'none';
  readonly agentId: string | undefined;
  readonly agentName: string;
  readonly modelLabel: string;
  /** Full prompt token estimate (e.g. `2.5K / 12K tokens`). */
  readonly tokenLabel: string;
  /** Agent has dedicated model pin (no workspace suffix). */
  readonly hasDedicatedModel: boolean;
  /** 生效模型来源（agent pin → session 覆盖 → workspace）。 */
  readonly modelSource: ChatAgentModelSource;
}

/**
 * 按项目 + 会话解析 Agent 元信息。
 *
 * custom 模式不含 agentId；session-bind 表示走会话级 agent 绑定。
 * modelSource 三档与 desktop `handlePromptAgentMeta` 保持一致：agent pin 压制一切
 * → 会话 bind 且带 modelId 覆盖 → 回退 workspace。
 */
export async function loadChatAgentMeta(
  runtime: MobileNovelMasterRuntime,
  projectId: string,
  sessionId: string,
): Promise<ChatAgentMeta> {
  try {
    const resolved = await resolveAgentForProject(
      runtime,
      projectId,
      sessionId,
    );
    const {definition} = resolved;
    const hasDedicatedModel =
      definition.model != null && definition.model !== '';
    const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? '';
    // 与 desktop prompt.ts 对齐：savedModelId 暂不掺入 sessionModelId，
    // modelLabel 反映 agent pin / workspace 当前模型；session override 仅由 modelSource 标识。
    const savedModelId = resolveApplicationModelId({
      agentModelId: definition.model,
      workspaceModelId: workspaceModelId || undefined,
    });
    let modelLabel = '未选择模型';
    if (savedModelId) {
      try {
        modelLabel = await resolveModelDisplayLabel(runtime, savedModelId);
      } catch {
        modelLabel = savedModelId;
      }
    }
    // modelSource 优先级链：agent pin 压制一切 → 会话 bind 带 modelId 覆盖 → 回退 workspace。
    // project-custom / global / none 不产生 session-override（custom 截断 session，global 表示 session 为 follow）。
    let modelSource: ChatAgentModelSource;
    if (hasDedicatedModel) {
      modelSource = 'agent-pin';
    } else if (resolved.source === 'session-bind') {
      const sessionConfig = await runtime.sessions.getSessionAgentConfig(
        sessionId,
      );
      modelSource =
        sessionConfig.mode === 'bind' && sessionConfig.modelId
          ? 'session-override'
          : 'workspace';
    } else {
      modelSource = 'workspace';
    }
    if (resolved.source === 'global') {
      return {
        source: 'global',
        agentId: resolved.agentId,
        agentName: definition.name,
        modelLabel,
        tokenLabel: '',
        hasDedicatedModel,
        modelSource,
      };
    }
    if (resolved.source === 'session-bind') {
      return {
        source: 'session-bind',
        agentId: resolved.agentId,
        agentName: definition.name,
        modelLabel,
        tokenLabel: '',
        hasDedicatedModel,
        modelSource,
      };
    }
    return {
      source: 'project-custom',
      agentId: undefined,
      agentName: PROJECT_AGENT_META_DISPLAY_LABEL,
      modelLabel,
      tokenLabel: '',
      hasDedicatedModel,
      modelSource,
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
        modelSource: 'workspace',
      };
    }
    throw error;
  }
}
