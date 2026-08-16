/**
 * Chat header meta: current agent name + resolved model label (PRD D4)。
 *
 * source 用于区分 agent 来源（会话级引用）。
 * modelSource 用于区分生效模型来源（agent pin / 会话）。
 *
 * 项目智能体已下线：会话始终独立持有 agentId（必填），
 * 可选 modelId 覆盖 agent pin。meta 这里只把 core 的解析结果翻译成 UI 标签。
 */
import {
  AgentRunResolveError,
  resolveAgentForProject,
  resolveSavedModelId,
} from '@novel-master/core/agent';
import {ChatError} from '@novel-master/core/chat';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {resolveModelDisplayLabel} from '../provider/model-display-label';

/**
 * modelSource 与 desktop `PromptAgentMetaResponse.modelSource` 同语义
 * （不含 desktop 独有的 'cli'）：
 * agent 自带 pin 压制 → 否则跟随会话配置。
 */
export type ChatAgentModelSource = 'agent-pin' | 'session';

export interface ChatAgentMeta {
  readonly source: 'session' | 'none';
  readonly agentId: string | undefined;
  readonly agentName: string;
  readonly modelLabel: string;
  /** Full prompt token estimate (e.g. `2.5K / 12K tokens`). */
  readonly tokenLabel: string;
  /** Agent has dedicated model pin (no workspace suffix). */
  readonly hasDedicatedModel: boolean;
  /** 生效模型来源（agent pin → 会话）。 */
  readonly modelSource: ChatAgentModelSource;
}

/**
 * 按项目 + 会话解析 Agent 元信息。
 *
 * 项目智能体已下线：所有项目统一走 session 级——会话独立 agentId 解析得到
 * registry definition。
 *
 * modelSource 两档：agent definition 自带 model 压制一切，
 * 否则跟随会话（session.modelId 可选，作为 savedModelId 兜底）。
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
    // 会话级 agentId 解析后读 sessionConfig 拿 modelId，用于 savedModelId 兜底。
    const sessionConfig = await runtime.sessions.getSessionAgentConfig(
      sessionId,
    );
    const savedModelId = resolveSavedModelId({
      agentModelId: definition.model,
      sessionModelId: sessionConfig.modelId,
    });
    let modelLabel = '未选择模型';
    if (savedModelId) {
      try {
        modelLabel = await resolveModelDisplayLabel(runtime, savedModelId);
      } catch {
        modelLabel = savedModelId;
      }
    }
    // modelSource 优先级链：agent pin 压制 → 否则跟随会话。
    const modelSource: ChatAgentModelSource = hasDedicatedModel
      ? 'agent-pin'
      : 'session';
    return {
      source: 'session',
      agentId: resolved.agentId,
      agentName: definition.name,
      modelLabel,
      tokenLabel: '',
      hasDedicatedModel,
      modelSource,
    };
  } catch (error) {
    // AgentRunResolveError（agentId 指向已删 agent）与 ChatError（如配置缺失/
    // 迁移未跑）都归一为 source='none' 的安全默认 meta：调用方（详情页、
    // chat tab）拿到非 undefined meta 渲染未绑定引导，不再卡「加载中…」。
    if (error instanceof AgentRunResolveError || error instanceof ChatError) {
      return {
        source: 'none',
        agentId: undefined,
        agentName: '未配置 Agent',
        modelLabel: '—',
        tokenLabel: '',
        hasDedicatedModel: false,
        modelSource: 'session',
      };
    }
    throw error;
  }
}

/**
 * Agent 是否被锁定（不可在会话内切换）。
 *
 * 只有 source='session' 才放开，none（解析失败）一律视为锁定。meta 还没加载出来（undefined）时也按锁定处理，避免异常态误触。
 */
export function isAgentLocked(meta: ChatAgentMeta | undefined): boolean {
  if (!meta) {
    return true;
  }
  return meta.source !== 'session';
}

/**
 * Model 是否被锁定（不可在会话内覆盖）。
 *
 * Agent 锁定时 model 必然也锁；Agent 放开时再额外看 agent-pin 压制 / hasDedicatedModel。
 * hasDedicatedModel 已是 boolean（非 optional），不需要再兜 ?? false。
 */
export function isModelLocked(meta: ChatAgentMeta | undefined): boolean {
  if (!meta) {
    return true;
  }
  return (
    isAgentLocked(meta) ||
    meta.modelSource === 'agent-pin' ||
    meta.hasDedicatedModel
  );
}
