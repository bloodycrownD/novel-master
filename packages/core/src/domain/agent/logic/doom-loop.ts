/**
 * Doom loop detection for repeated identical tool_use blocks.
 *
 * @module domain/agent/doom-loop
 */

import type { ContentBlock, ToolUseBlock } from "@/domain/chat/model/content-block.js";
import { agentDoomLoop, AgentError } from "@/errors/agent-runtime-errors.js";

/** Consecutive identical tool_use invocations before abort. */
export const DOOM_LOOP_THRESHOLD = 3;

function toolUseBlocks(blocks: readonly ContentBlock[]): ToolUseBlock[] {
  return blocks.filter((b): b is ToolUseBlock => b.type === "tool_use");
}

function sameInput(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Throws {@link AgentError} `DOOM_LOOP` when the last `DOOM_LOOP_THRESHOLD`
 * `tool_use` blocks in the list share the same name and JSON input.
 */
export function assertNoDoomLoop(toolUses: readonly ToolUseBlock[]): void {
  if (toolUses.length < DOOM_LOOP_THRESHOLD) {
    return;
  }
  const tail = toolUses.slice(-DOOM_LOOP_THRESHOLD);
  const first = tail[0]!;
  const allSame = tail.every(
    (t) => t.name === first.name && sameInput(t.input, first.input),
  );
  if (allSame) {
    throw agentDoomLoop(first.name);
  }
}

/**
 * Checks doom loop against the last N tool_use blocks in an assistant message.
 */
export function assertNoDoomLoopInBlocks(blocks: readonly ContentBlock[]): void {
  assertNoDoomLoop(toolUseBlocks(blocks));
}
