/**
 * Real prompt preview: agent prompts + llm-channel regex + structured segments.
 */
import { buildPromptPreviewSegmentsFromLayout, type PromptPreviewSegment } from "@novel-master/core/prompt";
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {buildSessionPromptInput} from './session-prompt-input.service';
import {resolveCurrentAgentDefinition} from './agent-run.service';

export interface PromptPreviewScope {
  readonly projectId: string;
  readonly sessionId: string;
}

/** Ordered segments for collapsible real-prompt UI (one card per bubble). */
export async function buildRealPromptPreviewSegments(
  runtime: MobileNovelMasterRuntime,
  scope: PromptPreviewScope,
): Promise<readonly PromptPreviewSegment[]> {
  const {definition} = await resolveCurrentAgentDefinition(runtime);
  const {layout, ctx} = await buildSessionPromptInput(
    runtime,
    scope,
    definition,
  );
  return await buildPromptPreviewSegmentsFromLayout(layout, ctx);
}
