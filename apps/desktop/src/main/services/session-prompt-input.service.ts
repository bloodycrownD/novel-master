/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import { type AgentDefinition, resolveAgentForProject } from "@novel-master/core/agent";
import { prepareUserMessagesForPrompt } from "@novel-master/core/chat";
import { buildPromptLlmInputFromLayout, type AgentPromptLayout, type PromptLlmInput, type PromptRenderContext } from "@novel-master/core/prompt";
import { assembleWorkplaceDisplay } from "@novel-master/core/workplace";
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
  const regexMessages = await applyActiveRegexChannel(
    runtime.regexConfig,
    activeGroupId,
    allMessages,
    visible,
    "llm",
  );
  const wtScope = {
    kind: "session" as const,
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  };
  const wt = runtime.workplace(wtScope);
  const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
  // assemble → prepare(S0)，与 agent-runner 同源。
  const { workplaceDisplay, prefixPaths } = await assembleWorkplaceDisplay(
    wtScope,
    {
      sessionKkv: runtime.sessionKkv,
      workplace: wt,
      vfs,
      layout: resolved.prompts,
    },
  );
  const messages = await prepareUserMessagesForPrompt(regexMessages, {
    sessionId: scope.sessionId,
    sessionKkv: runtime.sessionKkv,
    vfs,
    seenPaths: prefixPaths,
  });
  const ctx: PromptRenderContext = {
    workplaceDisplay,
    messages,
    workplace: wt,
    vfs,
  };
  // 预览与 token 计数默认 agentStepIndex 为 0，含 once dynamic 块
  const input = await buildPromptLlmInputFromLayout(resolved.prompts, ctx);
  return { definition: resolved, layout: resolved.prompts, ctx, input };
}
