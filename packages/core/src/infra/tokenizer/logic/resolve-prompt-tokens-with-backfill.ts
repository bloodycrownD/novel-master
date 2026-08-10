/**
 * cache miss → 从 rawMessages 回填 → 重 resolve 的组合步骤。
 *
 * desktop / mobile 两端原先各自内联同一段逻辑，这里收敛到 core，避免
 * resolve 行为一变就要两端同步改。compaction trigger 不走这里。
 *
 * @module infra/tokenizer/logic/resolve-prompt-tokens-with-backfill
 */

import type { ChatMessage } from "../../../domain/chat/model/message.js";
import type { CountPromptLlmInputParams } from "./count-prompt-llm-input.js";
import { backfillCacheFromMessages } from "./backfill-cache-from-messages.js";
import {
  resolveCurrentPromptTokens,
  type ResolvedPromptTokens,
} from "./resolve-current-prompt-tokens.js";

/**
 * 先 resolve 一次；若来源是 `local`（即进程内无 API 缓存），尝试从
 * `rawMessages` 回填缓存，命中就再 resolve 一次（这次会走 `source:"api"`）。
 *
 * `rawMessages` 来自 SessionPromptInputBundle，调用方负责保证它和 `params`
 * 描述的是同一份 prompt——这里不做一致性校验。
 */
export async function resolvePromptTokensWithBackfill(
  sessionId: string,
  rawMessages: readonly ChatMessage[],
  params: CountPromptLlmInputParams,
): Promise<ResolvedPromptTokens> {
  let result = await resolveCurrentPromptTokens(sessionId, params);
  if (result.source === "local") {
    if (backfillCacheFromMessages(sessionId, rawMessages)) {
      result = await resolveCurrentPromptTokens(sessionId, params);
    }
  }
  return result;
}
