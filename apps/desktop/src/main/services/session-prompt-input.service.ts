/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import {
  buildPromptLlmInputFromLayout,
  type AgentDefinition,
  type AgentPromptLayout,
  type PromptLlmInput,
  type PromptRenderContext,
} from "@novel-master/core";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { applyActiveRegexChannel } from "./regex-apply-channel.service.js";
import { resolveCurrentAgentDefinition } from "./agent-run.service.js";

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

async function getSessionWorktreeSnapshot(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
) {
  const wt = runtime.worktree({
    kind: "session",
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  });
  return runtime.worktreeSnapshot.getOrRefresh(
    scope.projectId,
    scope.sessionId,
    () => wt.materialize(),
  );
}

export async function buildSessionPromptInput(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
  definition?: AgentDefinition,
): Promise<SessionPromptInputBundle> {
  const resolved =
    definition ?? (await resolveCurrentAgentDefinition(runtime)).definition;

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
  const snapshot = await getSessionWorktreeSnapshot(runtime, scope);
  const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
  const ctx: PromptRenderContext = {
    worktreeDisplay: snapshot.worktreeDisplay,
    messages,
    vfs,
  };
  // 预览与 token 计数默认 agentStepIndex 为 0，含 once dynamic 块
  const input = await buildPromptLlmInputFromLayout(resolved.prompts, ctx);
  return { definition: resolved, layout: resolved.prompts, ctx, input };
}
