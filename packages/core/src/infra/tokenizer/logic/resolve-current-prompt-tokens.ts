/**
 * 当前 prompt 占用统一读口：有会话 API 占用（进程内热层或 session KKV）则
 * 用，否则本地 count。
 *
 * 口径一致性（治本点）：API 值落 session KKV 后，重启也读得到同一份
 * `promptTokens`——不再出现「重启前报 API、重启后跌本地估算」的跳变。
 * KKV 命中时仍返回 `source:"api"`，并附 `atMs`（「上次请求」标签与时效
 * 判定用）。
 *
 * @module infra/tokenizer/logic/resolve-current-prompt-tokens
 */

import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import {
  countPromptLlmInput,
  type CountPromptLlmInputParams,
} from "./count-prompt-llm-input.js";
import { readSessionApiPromptTokenEntry } from "./session-api-prompt-token-store.js";

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
  /**
   * `source==="api"` 时的采样时刻（epoch 毫秒；旧格式值无该字段时为 0）。
   * `source==="local"` 时省略。
   */
  readonly atMs?: number;
}

/** {@link resolveCurrentPromptTokens} 的可选依赖。 */
export interface ResolveCurrentPromptTokensOptions {
  /**
   * 会话 KKV：读口用它做跨重启的 API 值恢复。缺省时退化为纯进程内读
   * （与落库前行为一致，旧调用方无需改动）。
   */
  readonly sessionKkv?: SessionKkvService | null;
}

/**
 * 展示与压缩共用的唯一读口。签名必带 `sessionId`。
 *
 * 命中判定：热层（进程内 Map）→ session KKV。两条路径上若值的
 * `savedModelId` 指纹与本次请求的 `params.savedModelId` 不符，一律当 miss
 * （换模型后旧口径的占用不再适用，且避免把上一个模型的精确值喂给新模型的
 * 阈值判定）；无指纹（旧格式值）按兼容处理照常采用。
 */
export async function resolveCurrentPromptTokens(
  sessionId: string,
  params: CountPromptLlmInputParams,
  options?: ResolveCurrentPromptTokensOptions
): Promise<ResolvedPromptTokens> {
  const entry = await readSessionApiPromptTokenEntry(
    options?.sessionKkv,
    sessionId
  );
  if (
    entry != null &&
    (entry.savedModelId == null || entry.savedModelId === params.savedModelId)
  ) {
    return {
      tokenCount: entry.promptTokens,
      source: "api",
      estimated: false,
      counterKind: "api",
      atMs: entry.atMs,
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
