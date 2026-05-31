/**
 * Real prompt preview: agent prompts + llm-channel regex + formatPromptLlmInputForCli.
 */
import {
  buildPromptLlmInput,
  formatPromptLlmInputForCli,
  type AgentDefinition,
} from '@novel-master/core';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {applyActiveRegexChannel} from './regex-apply-channel';
import {resolveCurrentAgentDefinition} from './agent-run.service';

export interface PromptPreviewScope {
  readonly projectId: string;
  readonly sessionId: string;
}

/** Builds CLI-formatted prompt text for the current agent and session scope. */
export async function buildRealPromptPreview(
  runtime: MobileNovelMasterRuntime,
  scope: PromptPreviewScope,
): Promise<string> {
  const {definition} = await resolveCurrentAgentDefinition(runtime);
  return buildPromptPreviewForDefinition(runtime, scope, definition);
}

async function buildPromptPreviewForDefinition(
  runtime: MobileNovelMasterRuntime,
  scope: PromptPreviewScope,
  definition: AgentDefinition,
): Promise<string> {
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
  const worktreeDisplay = await runtime
    .worktree({
      kind: 'session',
      projectId: scope.projectId,
      sessionId: scope.sessionId,
    })
    .renderDisplay();

  const ctx = {worktreeDisplay, messages};
  const input = buildPromptLlmInput(definition.prompts, ctx);
  return formatPromptLlmInputForCli(definition.prompts, input, ctx);
}
