/**
 * Real prompt preview: agent prompts + structured segments.
 */
import {registerBuiltinTools, ToolRegistry} from '@novel-master/core';
import {
  resolveAgentForProject,
  resolveAgentToolRegistry,
  type AgentDefinition,
} from '@novel-master/core/agent';
import {
  applyThinkingContextForLlm,
  buildPromptPreviewTurnsFromLayout,
  resolvePreviewThinkingContext,
  type PromptPreviewTurn,
  type PromptRenderContext,
  type PromptSkillIndexEntry,
} from '@novel-master/core/prompt';
import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {buildSessionPromptInput} from './session-prompt-input.service';

export interface PromptPreviewScope {
  readonly projectId: string;
  readonly sessionId: string;
}

/** 与 core skill-tool 的 SKILL_TOOL_NAME 同值（core 未公开导出，本地常量）。 */
const SKILL_TOOL_NAME = 'skill';

/**
 * 预算技能索引（与 agent-runner 同源：effectiveSkills 生效清单）。
 *
 * D4 联动：resolve 后 registry 不含 skill（policy 禁用）时返回 undefined，
 * 预览不出现技能索引段——工具与索引同进退。
 */
async function budgetSkillsIndex(
  runtime: MobileNovelMasterRuntime,
  projectId: string,
  definition: AgentDefinition,
): Promise<readonly PromptSkillIndexEntry[] | undefined> {
  const probe = new ToolRegistry();
  registerBuiltinTools(probe);
  const registry = resolveAgentToolRegistry(probe, definition);
  if (!registry.list().includes(SKILL_TOOL_NAME)) {
    return undefined;
  }
  const effective = await runtime.skills().effectiveSkills(projectId);
  return effective
    .filter(s => s.effective)
    .map(s => ({
      name: s.name,
      description: s.description ?? '',
      domain: s.domain,
    }));
}

/**
 * 按「轮」聚合的真实提示词（R4）：模板段各占一轮、真用户输入开一轮、
 * 其余 assistant 文本/thinking/工具段归入同一 assistant 轮。轮摘要口径在
 * core 侧钉死，本地不再二次加工。
 */
export async function buildRealPromptPreviewSegments(
  runtime: MobileNovelMasterRuntime,
  scope: PromptPreviewScope,
): Promise<readonly PromptPreviewTurn[]> {
  const {definition} = await resolveAgentForProject(
    runtime,
    scope.projectId,
    scope.sessionId,
  );
  const {layout, ctx} = await buildSessionPromptInput(
    runtime,
    scope,
    definition,
  );
  const skillsIndex = await budgetSkillsIndex(
    runtime,
    scope.projectId,
    definition,
  );
  // 思考上下文偏好：预览与 wire 同口径（档位前置门 + 容量 1 保留单点在 core 纯函数）；
  // 判定链已下沉 core（resolvePreviewThinkingContext），本地不再持有副本。
  const sessionConfig = await runtime.sessions.getSessionAgentConfig(
    scope.sessionId,
  );
  const thinking = await resolvePreviewThinkingContext({
    preferences: runtime.preferences,
    savedModels: runtime.savedModelRepo,
    providers: runtime.providerRepo,
    agentModelId: definition.model,
    sessionModelId: sessionConfig.modelId,
  });
  // 预览输入 ctx.messages 不含合成消息，但容量 1 判定只看 assistant 消息，
  // 判定代码与 wire 侧同一段，两侧保留集合一致（T-PV2）。
  const filteredMessages = applyThinkingContextForLlm(ctx.messages, {
    enabled: thinking.enabled,
    protocol: thinking.protocol,
    retainProtocolMinimum: false,
    requestThinkingEnabled: thinking.requestThinkingEnabled,
  });
  const previewCtx: PromptRenderContext =
    skillsIndex != null
      ? {...ctx, skillsIndex, messages: filteredMessages}
      : {...ctx, messages: filteredMessages};
  return await buildPromptPreviewTurnsFromLayout(layout, previewCtx, {
    includeThinkingBlocks: thinking.enabled,
  });
}
