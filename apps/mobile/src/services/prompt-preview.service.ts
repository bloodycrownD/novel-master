/**
 * Real prompt preview: agent prompts + llm-channel regex + formatPromptLlmInputForCli.
 */
import {formatPromptLlmInputForCli, type AgentDefinition} from '@novel-master/core';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {buildSessionPromptInput} from './session-prompt-input.service';
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
  const {ctx, input} = await buildSessionPromptInput(
    runtime,
    scope,
    definition,
  );
  return formatPromptLlmInputForCli(definition.prompts, input, ctx);
}
