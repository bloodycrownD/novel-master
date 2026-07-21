/**
 * 从多轮 model round 中取末轮可用 promptTokens。
 *
 * @module infra/tokenizer/logic/pick-last-prompt-usage
 */

import type { ModelRoundSummary } from "@/domain/agent/model/agent-run-result.js";

/**
 * 自后向前扫描 rounds，返回最后一个有限数值的 `usage.promptTokens`（含合法 `0`）。
 * 禁止用 totalTokens / completion 冒充。
 */
export function pickLastPromptUsage(
  rounds: readonly ModelRoundSummary[],
): number | undefined {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const p = rounds[i]?.usage?.promptTokens;
    if (typeof p === "number" && Number.isFinite(p)) {
      return p;
    }
  }
  return undefined;
}
