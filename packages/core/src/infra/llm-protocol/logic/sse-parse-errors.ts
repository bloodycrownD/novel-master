/**
 * 畸形 SSE 行诊断（计数、调试告警、finish 断言）。
 *
 * @module infra/llm-protocol/logic/sse-parse-errors
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import { createLogger } from "@/infra/log/logger.js";
import type { DegradedToolCall, LlmProtocolKind } from "../ports/adapter.port.js";

const log = createLogger("llm.sse-parse");

/** 各 SSE parser 共享的诊断字段。 */
export interface SseParseDiagnostics {
  malformedLineCount: number;
}

/** 各 SSE parser finish 函数共享的收尾结果形状。 */
export type SseFinishResult = {
  blocks: ContentBlock[];
  streamRaw: unknown;
  degradedToolCalls: DegradedToolCall[];
};

/**
 * 是否输出畸形 SSE 行的调试告警。
 * 仅读取环境变量：优先 `NM_DEBUG_LLM_SSE=1`，回退 `NM_DEBUG_LLM_FETCH=1`（与 transport 调试一致）。
 */
export function isSseParseDebugEnabled(): boolean {
  if (process.env.NM_DEBUG_LLM_SSE === "1") {
    return true;
  }
  if (process.env.NM_DEBUG_LLM_FETCH === "1") {
    return true;
  }
  return false;
}

/** 记录一条无法 JSON 解析的 SSE data 行。 */
export function recordMalformedSseLine(diag: SseParseDiagnostics, payload: string): void {
  diag.malformedLineCount += 1;
  if (isSseParseDebugEnabled()) {
    // 畸形行是响应正文：用正文键交给脱敏层压成 {chars, hash}，不落原文。
    log.warn("malformed JSON line", { body: payload });
  }
}

/** 零内容块且存在畸形行时报 PROVIDER_MALFORMED_SSE（失败走返回值通道；名字保留自 throw 时代，调用方按 `Result` 拆包）。 */
export function assertSseParseSucceededOrThrow(diag: SseParseDiagnostics, blocks: readonly unknown[], protocol: LlmProtocolKind): Result<void, AppError> {
  if (blocks.length === 0 && diag.malformedLineCount > 0) {
    return Result.err(new AppError("PROVIDER_MALFORMED_SSE", { detail: `${protocol}: stream ended with no content after ${diag.malformedLineCount} malformed SSE line(s)` }));
  }
  return Result.ok(undefined);
}
