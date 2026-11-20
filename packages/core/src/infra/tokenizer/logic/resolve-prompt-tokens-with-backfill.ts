/**
 * prompt token 计数入口（chat-prompt-tokens service 用）。
 *
 * desktop / mobile 两端原先各自内联 resolve 逻辑，这里收敛到 core。compaction
 * trigger 不走这里。历史上的「cache miss → 从 rawMessages 回填 → 重 resolve」
 * 步骤已废弃（置位/压缩后上下文范围变了，回填的旧值不准确），现在直接 resolve。
 *
 * @module infra/tokenizer/logic/resolve-prompt-tokens-with-backfill
 */

import type { ChatMessageData } from "../../../domain/chat/model/message.js";
import type { Outcome } from "../../../errors/outcome.js";
import type { CountPromptLlmInputParams } from "./count-prompt-llm-input.js";
import { CurrentPromptTokens, type ResolveCurrentPromptTokensOptions, type ResolvedPromptTokens } from "./resolve-current-prompt-tokens.js";

type PromptTokensOptions = ResolveCurrentPromptTokensOptions;
type PromptTokensResult = Outcome<ResolvedPromptTokens>;

export const PromptTokens = {
  /**
   * resolve 一次 prompt token 计数。
   *
   * `rawMessages` 参数已无实际用途，仅为兼容既有调用方签名保留；下个清理
   * 迭代可连同调用方一起移除。
   *
   * `options.sessionKkv` 透传给读口：双端 service 传入自己的 sessionKkv
   * 后，重启也能读到上次 completed run 的 API 占用（同口径）。
   *
   * `options.shouldBail` 同样原样透传（r3-chip-1）：本函数不再有任何自己的
   * 步骤，弃权观察点全在 {@link CurrentPromptTokens.resolve} 内部的两处整串级
   * 重活之前——读口传进来即生效，不传则恒不弃权（既有调用方零影响）。弃权
   * 沿 `Outcome.cancelled` / `Outcome.replaced` 透传（错误通道迁移二期：哨兵
   * throw 改返回值，读口按 kind 判定收口）。
   */
  async resolve(sessionId: string, _raw: readonly ChatMessageData[], params: CountPromptLlmInputParams, opts?: PromptTokensOptions): Promise<PromptTokensResult> {
    return CurrentPromptTokens.resolve(sessionId, params, opts);
  },
} as const;
