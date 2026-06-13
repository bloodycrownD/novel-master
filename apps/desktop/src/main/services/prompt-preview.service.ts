/**
 * Real prompt preview segments for desktop conversation tab.
 */
import {
  buildPromptPreviewSegmentsFromLayout,
  type PromptPreviewSegment,
} from "@novel-master/core";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { resolveCurrentAgentDefinition } from "./agent-run.service.js";
import { buildSessionPromptInput } from "./session-prompt-input.service.js";

export interface PromptPreviewScope {
  readonly projectId: string;
  readonly sessionId: string;
}

export async function buildRealPromptPreviewSegments(
  runtime: DesktopNovelMasterRuntime,
  scope: PromptPreviewScope,
): Promise<readonly PromptPreviewSegment[]> {
  const { definition } = await resolveCurrentAgentDefinition(runtime);
  const { layout, ctx } = await buildSessionPromptInput(
    runtime,
    scope,
    definition,
  );
  return await buildPromptPreviewSegmentsFromLayout(layout, ctx);
}
