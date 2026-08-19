/**
 * Real prompt preview: agent prompts + llm-channel regex + structured segments.
 */
import {registerBuiltinTools, ToolRegistry} from '@novel-master/core';
import {
  resolveAgentForProject,
  resolveAgentToolRegistry,
  type AgentDefinition,
} from '@novel-master/core/agent';
import {
  buildPromptPreviewSegmentsFromLayout,
  type PromptPreviewSegment,
  type PromptRenderContext,
  type PromptSkillIndexEntry,
} from '@novel-master/core/prompt';
import type {MobileNovelMasterRuntime} from '../runtime/types';
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

/** Ordered segments for collapsible real-prompt UI (one card per bubble). */
export async function buildRealPromptPreviewSegments(
  runtime: MobileNovelMasterRuntime,
  scope: PromptPreviewScope,
): Promise<readonly PromptPreviewSegment[]> {
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
  const previewCtx: PromptRenderContext =
    skillsIndex != null ? {...ctx, skillsIndex} : ctx;
  return await buildPromptPreviewSegmentsFromLayout(layout, previewCtx);
}
