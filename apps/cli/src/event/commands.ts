/**
 * `nm event emit` — run configured event actions for current scope.
 *
 * @module event/commands
 */

import { EVENT_SESSION_COMPACTION_REQUESTED, type EventOrchestrator } from "@novel-master/core/events";
import type { NovelMasterRuntime } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runEvent(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  if (subcommand !== "emit") {
    throw new Error("Usage: nm event emit <eventType> [--session <id>] [--project <id>]");
  }
  const { positional, flags } = parseCliArgs(args);
  const eventType = positional[0];
  if (eventType == null) {
    throw new Error("Usage: nm event emit <eventType> [--session <id>] [--project <id>]");
  }

  const projectId = await rt.scope.resolveProjectId(flags);
  const sessionId = await rt.scope.resolveSessionId(flags);

  const result = await rt.eventOrchestrator.emit(eventType, {
    sessionId,
    projectId,
    trigger:
      eventType === EVENT_SESSION_COMPACTION_REQUESTED ? "manual" : undefined,
  });

  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    throw new Error(`event ${eventType} completed with failures`);
  }
}

export type { EventOrchestrator };
