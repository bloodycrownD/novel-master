/**
 * prompt token 计数入口（chat-prompt-tokens service 用）。
 *
 * desktop / mobile 两端原先各自内联 resolve 逻辑，这里收敛到 core。compaction
 * trigger 不走这里。历史上的「cache miss → 从 rawMessages 回填 → 重 resolve」
 * 步骤已废弃（置位/压缩后上下文范围变了，回填的旧值不准确），现在直接 resolve。
 *
 * @module infra/tokenizer/logic/resolve-prompt-tokens-with-backfill
 */

import type { ChatMessage } from "../../../domain/chat/model/message.js";
import type { CountPromptLlmInputParams } from "./count-prompt-llm-input.js";
import {
  resolveCurrentPromptTokens,
  type ResolvedPromptTokens,
} from "./resolve-current-prompt-tokens.js";

/**
 * resolve 一次 prompt token 计数。
 *
 * `rawMessages` 参数已无实际用途，仅为兼容既有调用方签名保留；下个清理
 * 迭代可连同调用方一起移除。
 */
export async function resolvePromptTokensWithBackfill(
  sessionId: string,
  _rawMessages: readonly ChatMessage[],
  params: CountPromptLlmInputParams
): Promise<ResolvedPromptTokens> {
  return resolveCurrentPromptTokens(sessionId, params);
}
