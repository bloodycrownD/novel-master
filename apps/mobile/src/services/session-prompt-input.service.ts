/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import {
  buildPromptLlmInput,
  type AgentDefinition,
  type PromptBlock,
  type PromptLlmInput,
  type PromptRenderContext,
} from '@novel-master/core';
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
  readonly blocks: readonly PromptBlock[];
  readonly ctx: PromptRenderContext;
  readonly input: PromptLlmInput;
}

/** Visible session messages + worktree context → LLM input for current agent. */
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
  const worktreeDisplay = snapshot.worktreeDisplay;
  const filetreeDisplay = snapshot.filetreeDisplay;

  const ctx: PromptRenderContext = {worktreeDisplay, filetreeDisplay, messages};
  const input = buildPromptLlmInput(resolved.prompts, ctx);
  return {definition: resolved, blocks: resolved.prompts, ctx, input};
}
