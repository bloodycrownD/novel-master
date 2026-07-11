/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import { type AgentDefinition, resolveAgentForProject } from "@novel-master/core/agent";

import { buildPromptLlmInputFromLayout, type AgentPromptLayout, type PromptLlmInput, type PromptRenderContext } from "@novel-master/core/prompt";
import { getCapturedBlockOrCapture } from "@novel-master/core/worktree";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { applyActiveRegexChannel } from "./regex-apply-channel.service.js";

export interface SessionPromptScope {
  readonly projectId: string;
  readonly sessionId: string;
}

export interface SessionPromptInputBundle {
  readonly definition: AgentDefinition;
  readonly layout: AgentPromptLayout;
  readonly ctx: PromptRenderContext;
  readonly input: PromptLlmInput;
}

export async function buildSessionPromptInput(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
  definition?: AgentDefinition,
): Promise<SessionPromptInputBundle> {
  const resolved =
    definition ??
    (await resolveAgentForProject(runtime, scope.projectId)).definition;

  const allMessages = await runtime.messages.listBySession(scope.sessionId);
  const visible = allMessages.filter((m) => !m.hidden);
  const activeGroupId = await runtime.state.getCurrentRegexGroupId();
  const messages = await applyActiveRegexChannel(
    runtime.regexConfig,
    activeGroupId,
    allMessages,
    visible,
    "llm",
  );
  const block = await getCapturedBlockOrCapture(
    {
      kind: "session",
      projectId: scope.projectId,
      sessionId: scope.sessionId,
    },
    {
      worktree: (s) => runtime.worktree(s),
      worktreeBlockStore: runtime.worktreeBlockStore,
    },
  );
  const wt = runtime.worktree({
    kind: "session",
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  });
  const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
  const ctx: PromptRenderContext = {
    worktreeDisplay: block.worktreeDisplay,
    messages,
    worktree: wt,
    vfs,
  };
  // 预览与 token 计数默认 agentStepIndex 为 0，含 once dynamic 块
  const input = await buildPromptLlmInputFromLayout(resolved.prompts, ctx);
  return { definition: resolved, layout: resolved.prompts, ctx, input };
}
