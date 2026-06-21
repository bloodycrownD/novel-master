/**
 * 畸形 SSE 行诊断（计数、调试告警、finish 断言）。
 *
 * @module infra/llm-protocol/logic/sse-parse-errors
 */

import { ProviderError } from "@/errors/provider-errors.js";
import type { LlmProtocolKind } from "../ports/adapter.port.js";

/** 各 SSE parser 共享的诊断字段。 */
export interface SseParseDiagnostics {
  malformedLineCount: number;
}

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
export function recordMalformedSseLine(
  diag: SseParseDiagnostics,
  payload: string,
): void {
  diag.malformedLineCount += 1;
  if (isSseParseDebugEnabled()) {
    const prefix =
      payload.length > 120 ? payload.slice(0, 120) + "…" : payload;
    console.warn("[llm-sse] malformed JSON line:", prefix);
  }
}

/** 零内容块且存在畸形行时抛错。 */
export function assertSseParseSucceededOrThrow(
  diag: SseParseDiagnostics,
  blocks: readonly unknown[],
  protocol: LlmProtocolKind,
): void {
  if (blocks.length === 0 && diag.malformedLineCount > 0) {
    throw new ProviderError(
      "MALFORMED_SSE",
      `${protocol}: stream ended with no content after ${diag.malformedLineCount} malformed SSE line(s)`,
    );
  }
}
