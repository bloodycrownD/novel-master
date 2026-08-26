/**
 * Real prompt preview segments for desktop conversation tab.
 */
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";
import {
  inferLlmProtocolFromSavedModelId,
} from "@novel-master/core/provider";
import {
  resolveAgentForProject,
  resolveAgentToolRegistry,
  resolveSavedModelId,
  type AgentDefinition,
} from "@novel-master/core/agent";
import {
  applyThinkingContextForLlm,
  buildPromptPreviewSegmentsFromLayout,
  type PromptPreviewSegment,
  type PromptRenderContext,
  type PromptSkillIndexEntry,
} from "@novel-master/core/prompt";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { buildSessionPromptInput } from "./session-prompt-input.service.js";

export interface PromptPreviewScope {
  readonly projectId: string;
  readonly sessionId: string;
}

/** 与 core skill-tool 的 SKILL_TOOL_NAME 同值（core 未公开导出，本地常量）。 */
const SKILL_TOOL_NAME = "skill";

/**
 * 预算技能索引（与 agent-runner 同源：effectiveSkills 生效清单）。
 *
 * D4 联动：resolve 后 registry 不含 skill（policy 禁用）时返回 undefined，
 * 预览不出现技能索引段——工具与索引同进退。
 */
async function budgetSkillsIndex(
  runtime: DesktopNovelMasterRuntime,
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
    .filter((s) => s.effective)
    .map((s) => ({
      name: s.name,
      description: s.description ?? "",
      domain: s.domain,
    }));
}

/**
 * 思考上下文预过滤：与 wire 侧同源（共用 core 纯函数，边界判定不依赖 zones）。
 *
 * - `requestThinkingEnabled` 取值路径与 wire 侧 `resolveSavedModelId` 同优先级：
 *   agent pin 模型 → 会话 `modelId` 覆盖，再 `savedModels.findById` 读档位
 *   （`thinkingLevel !== "off"`）；取不到模型时按 true 兜底（档位按开态参与判定）。
 * - 预览不展示协议最低保留（`retainProtocolMinimum: false`，不向用户暴露）。
 */
async function resolvePreviewThinkingContext(
  runtime: DesktopNovelMasterRuntime,
  scope: PromptPreviewScope,
  definition: AgentDefinition,
): Promise<{
  readonly enabled: boolean;
  readonly requestThinkingEnabled: boolean;
  readonly protocol: "openai" | "anthropic" | "gemini";
}> {
  const enabled = await runtime.preferences.getThinkingContextEnabled();
  const sessionConfig = await runtime.sessions.getSessionAgentConfig(
    scope.sessionId,
  );
  const savedModelId = resolveSavedModelId({
    agentModelId: definition.model,
    sessionModelId: sessionConfig.modelId,
  });
  let requestThinkingEnabled = true;
  if (savedModelId != null && savedModelId !== "") {
    const saved = await runtime.savedModelRepo.findById(savedModelId);
    if (saved != null) {
      requestThinkingEnabled =
        saved.settings.generation.thinkingLevel !== "off";
    }
  }
  const protocol =
    savedModelId != null && savedModelId !== ""
      ? await inferLlmProtocolFromSavedModelId(
          savedModelId,
          runtime.savedModelRepo,
          runtime.providerRepo,
        )
      : "anthropic";
  return { enabled, requestThinkingEnabled, protocol };
}

export async function buildRealPromptPreviewSegments(
  runtime: DesktopNovelMasterRuntime,
  scope: PromptPreviewScope,
): Promise<readonly PromptPreviewSegment[]> {
  const { definition } = await resolveAgentForProject(
    runtime,
    scope.projectId,
    scope.sessionId,
  );
  const { layout, ctx } = await buildSessionPromptInput(
    runtime,
    scope,
    definition,
  );
  const skillsIndex = await budgetSkillsIndex(
    runtime,
    scope.projectId,
    definition,
  );
  // 思考上下文偏好：预览与 wire 同口径（档位前置门 + 边界判定单点在 core 纯函数）。
  const thinking = await resolvePreviewThinkingContext(
    runtime,
    scope,
    definition,
  );
  // 预览输入 ctx.messages 不含合成消息（"prompt:" 排除规则为 no-op），
  // 但判定代码与 wire 侧同一段，两侧剥离集合一致（T-PV2）。
  const filteredMessages = applyThinkingContextForLlm(ctx.messages, {
    enabled: thinking.enabled,
    protocol: thinking.protocol,
    retainProtocolMinimum: false,
    requestThinkingEnabled: thinking.requestThinkingEnabled,
  });
  const previewCtx: PromptRenderContext =
    skillsIndex != null
      ? { ...ctx, skillsIndex, messages: filteredMessages }
      : { ...ctx, messages: filteredMessages };
  return await buildPromptPreviewSegmentsFromLayout(layout, previewCtx, {
    includeThinkingBlocks: thinking.enabled,
  });
}
