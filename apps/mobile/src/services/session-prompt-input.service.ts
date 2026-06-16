/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import { type AgentDefinition } from "@novel-master/core/agent";

import { buildPromptLlmInputFromLayout, type AgentPromptLayout, type PromptLlmInput, type PromptRenderContext } from "@novel-master/core/prompt";
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {applyActiveRegexChannel} from './regex-apply-channel';
import {resolveCurrentAgentDefinition} from './agent-run.service';
import {getOrRefreshSessionWorktreeSnapshot} from './worktree-snapshot.service';

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

/** 可见会话消息 + worktree/VFS 上下文 → 当前 Agent 的 LLM 输入。 */
export async function buildSessionPromptInput(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
  definition?: AgentDefinition,
): Promise<SessionPromptInputBundle> {
  const resolved =
    definition ?? (await resolveCurrentAgentDefinition(runtime)).definition;

  const allMessages = await runtime.messages.listBySession(scope.sessionId);
  const visible = allMessages.filter(m => !m.hidden);
  const activeGroupId = await runtime.state.getCurrentRegexGroupId();
  const messages = await applyActiveRegexChannel(
    runtime.regexConfig,
    activeGroupId,
    allMessages,
    visible,
    'llm',
  );
  const snapshot = await getOrRefreshSessionWorktreeSnapshot(runtime, scope);
  const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
  const ctx: PromptRenderContext = {
    worktreeDisplay: snapshot.worktreeDisplay,
    messages,
    vfs,
  };
  const input = await buildPromptLlmInputFromLayout(resolved.prompts, ctx);
  return {definition: resolved, layout: resolved.prompts, ctx, input};
}
