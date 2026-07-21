/**
 * 当前 prompt 占用统一读口：有会话 API 缓存则用，否则本地 count。
 *
 * @module infra/tokenizer/logic/resolve-current-prompt-tokens
 */

import {
  countPromptLlmInput,
  type CountPromptLlmInputParams,
} from "./count-prompt-llm-input.js";
import { sessionApiPromptTokenCache } from "./session-api-prompt-token-cache.js";

/** 占用结果来源。 */
export type PromptTokenSource = "api" | "local";

/** {@link resolveCurrentPromptTokens} 返回值。 */
export interface ResolvedPromptTokens {
  readonly tokenCount: number;
  readonly source: PromptTokenSource;
  /**
   * `source==="api"` → 必须 `estimated:false`、`counterKind:"api"`。
   * `source==="local"` → 透传本地 count 的 estimated / counterKind。
   */
  readonly estimated: boolean;
  readonly counterKind: string;
}

/**
 * 展示与压缩共用的唯一读口。签名必带 `sessionId`。
 */
export async function resolveCurrentPromptTokens(
  sessionId: string,
  params: CountPromptLlmInputParams,
): Promise<ResolvedPromptTokens> {
  const cached = sessionApiPromptTokenCache.get(sessionId);
  if (cached != null) {
    return {
      tokenCount: cached.promptTokens,
      source: "api",
      estimated: false,
      counterKind: "api",
    };
  }

  const local = await countPromptLlmInput(params);
  return {
    tokenCount: local.tokenCount,
    source: "local",
    estimated: local.estimated,
    counterKind: local.counterKind,
  };
}
