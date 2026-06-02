/**
 * Doom loop detection for repeated identical tool_use blocks.
 *
 * @module domain/agent/doom-loop
 */

import type { ContentBlock, ToolUseBlock } from "@/domain/chat/model/content-block.js";
import { agentDoomLoop, AgentError } from "@/errors/agent-runtime-errors.js";

/** Consecutive identical tool_use invocations before abort. */
export const DOOM_LOOP_THRESHOLD = 3;
/** Sliding window size for cross-round pattern checks. */
export const CROSS_ROUND_WINDOW = 4;

export interface DoomLoopChecksConfig {
  readonly threshold?: number;
  readonly crossRoundWindow?: number;
}

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
export function assertNoDoomLoop(
  toolUses: readonly ToolUseBlock[],
  config?: DoomLoopChecksConfig,
): void {
  const threshold = config?.threshold ?? DOOM_LOOP_THRESHOLD;
  if (toolUses.length < threshold) {
    return;
  }
  const tail = toolUses.slice(-threshold);
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
export function assertNoDoomLoopInBlocks(
  blocks: readonly ContentBlock[],
  config?: DoomLoopChecksConfig,
): void {
  assertNoDoomLoop(toolUseBlocks(blocks), config);
}

function sameToolUse(a: ToolUseBlock, b: ToolUseBlock): boolean {
  return a.name === b.name && sameInput(a.input, b.input);
}

/**
 * Throws on A-B-A-B cross-round alternation in the recent tool-use trajectory.
 */
export function assertNoCrossRoundDoomLoop(
  toolUses: readonly ToolUseBlock[],
  config?: DoomLoopChecksConfig,
): void {
  const crossRoundWindow = config?.crossRoundWindow ?? CROSS_ROUND_WINDOW;
  if (crossRoundWindow < 4 || crossRoundWindow % 2 !== 0 || toolUses.length < crossRoundWindow) {
    return;
  }
  const tail = toolUses.slice(-crossRoundWindow);
  const [a1, b1] = tail;
  if (
    a1 != null &&
    b1 != null &&
    !sameToolUse(a1, b1) &&
    tail.every((toolUse, idx) => sameToolUse(idx % 2 === 0 ? a1 : b1, toolUse))
  ) {
    throw agentDoomLoop(`${a1.name}<->${b1.name}`);
  }
}
