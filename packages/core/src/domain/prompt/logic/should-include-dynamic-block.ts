/**
 * dynamic 区 lifecycle 过滤：`always` 每步带入，`once` 仅在 step 0 带入。
 *
 * @module domain/prompt/logic/should-include-dynamic-block
 */

import type { DynamicPromptBlock } from "../model/agent-prompt-layout.js";

/** 给定 agent 步索引时是否纳入该 dynamic 块。 */
export function shouldIncludeDynamicBlock(
  block: DynamicPromptBlock,
  agentStepIndex: number,
): boolean {
  const lifecycle = block.lifecycle ?? "always";
  if (lifecycle === "always") {
    return true;
  }
  return agentStepIndex === 0;
}
