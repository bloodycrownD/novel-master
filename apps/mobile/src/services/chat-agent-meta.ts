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
import {resolveModelDisplayLabel} from './model-display-label';

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
    // resolveAgentForProject 与 getSessionAgentConfig 互不依赖（后者只需
    // sessionId，且为无副作用的读取），并行发起；resolveModelDisplayLabel
    // 依赖两者结果合成的 savedModelId，必须等两边都回来，保持串行。
    const sessionConfigPromise = runtime.sessions.getSessionAgentConfig(
      sessionId,
    );
    // 兜底挂接：resolveAgentForProject 先失败提前退出（归一 none meta /
    // rethrow）时，本路在途的拒绝不会变成 unhandled rejection；
    // 真正的错误仍在下方 await 按原语义抛出。
    sessionConfigPromise.catch(() => undefined);
    const resolved = await resolveAgentForProject(
      runtime,
      projectId,
      sessionId,
    );
    const sessionConfig = await sessionConfigPromise;
    const {definition} = resolved;
    const hasDedicatedModel =
      definition.model != null && definition.model !== '';
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
 * 锁定 / 待重选提示文案统一收口（screens/C-11）。
 *
 * isAgentLocked 拆分后（none 态放开为待重选），agent 锁定 toast 仅在
 * meta 还没加载出来时触发，两处文案统一为加载中语义；none 态点击
 * 智能体卡则提示重选语义并正常弹 picker，不再锁死。
 */
/** 会话面板锁定提示：meta 未加载，稍候再试。 */
export const AGENT_LOCK_TOAST_GUIDE = '智能体信息加载中，请稍候再试';
/** 会话详情页锁定提示：meta 未加载，稍候再试。 */
export const AGENT_LOCK_TOAST_STATEMENT = '智能体信息加载中，请稍候再试';
/** none 态（智能体已被删除）点击智能体卡的待重选提示。 */
export const AGENT_RESELECT_TOAST = '智能体已被删除，请重新选择';
/** none 态智能体卡上的待重选 badge 文案。 */
export const AGENT_RESELECT_HINT = '智能体已删除 · 点击重选';
/** 模型锁定提示：会话面板与会话详情页共用同一文案。 */
export const MODEL_LOCK_TOAST = '当前智能体已锁定模型，会话内无法覆盖';

/**
 * Agent 是否被锁定（不可在会话内切换）。
 *
 * 仅在 meta 还没加载出来（undefined）时按锁定处理，避免加载中误触；
 * source='none'（绑定的智能体已被删除）时不再锁定——智能体卡放开为
 * 「待重选」，可点击弹 picker 重选，写入新 agentId 后悬空即解除。
 */
export function isAgentLocked(meta: ChatAgentMeta | undefined): boolean {
  return meta == null;
}

/**
 * 智能体是否处于「已删待重选」态（meta 已加载且解析失败）。
 *
 * 该态下智能体卡不锁定：可点击弹 picker，选中存在的智能体后悬空解除。
 */
export function isAgentDeleted(meta: ChatAgentMeta | undefined): boolean {
  return meta != null && meta.source === 'none';
}

/**
 * Model 是否被锁定（不可在会话内覆盖）。
 *
 * 维持原口径：meta 为空或 source!=='session'（含 none——智能体没了，
 * pin 的模型无从解析，重选智能体后自然解锁）即锁定；source='session'
 * 时再额外看 agent-pin 压制 / hasDedicatedModel。
 * 注意 isAgentLocked 拆分后不能再借它判定，这里直接写 source 条件。
 * hasDedicatedModel 已是 boolean（非 optional），不需要再兜 ?? false。
 */
export function isModelLocked(meta: ChatAgentMeta | undefined): boolean {
  if (!meta) {
    return true;
  }
  return (
    meta.source !== 'session' ||
    meta.modelSource === 'agent-pin' ||
    meta.hasDedicatedModel
  );
}
