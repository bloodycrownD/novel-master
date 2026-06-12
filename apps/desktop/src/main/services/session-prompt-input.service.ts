/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import {
  buildPromptLlmInput,
  type AgentDefinition,
  type PromptBlock,
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
  readonly blocks: readonly PromptBlock[];
  readonly ctx: PromptRenderContext;
  readonly input: PromptLlmInput;
}

async function getSessionWorktreeSnapshot(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
) {
  const cached = runtime.macroCache.get(scope.projectId, scope.sessionId);
  if (cached != null && Array.isArray(cached.listRows)) {
    return cached;
  }
  const wt = runtime.worktree({
    kind: "session",
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  });
  return runtime.macroCache.refresh(scope.projectId, scope.sessionId, () =>
    wt.materialize(),
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
  const ctx: PromptRenderContext = {
    worktreeDisplay: snapshot.worktreeDisplay,
    filetreeDisplay: snapshot.filetreeDisplay,
    messages,
  };
  // buildPromptLlmInput 默认 agentStepIndex 为 0；预览与 token 计数含 once 块
  const input = buildPromptLlmInput(resolved.prompts, ctx);
  return { definition: resolved, blocks: resolved.prompts, ctx, input };
}
