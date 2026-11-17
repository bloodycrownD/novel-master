/**
 * 三协议 SSE 共用的 `data:` 行 envelope：切行 → 取 payload → 跳过 `[DONE]` → JSON 解析 → 畸形行计数。
 *
 * 逐字节相同的一段只在 `onEvent` 之后分叉（各家状态机不同构）。
 *
 * @module infra/llm-protocol/logic/sse-json-events
 */

import { feedSseLines } from "./sse-line-buffer.js";
import { parseSseDataLine } from "./sse-data-line.js";
import { recordMalformedSseLine, type SseParseDiagnostics } from "./sse-parse-errors.js";

/**
 * 喂入一个 UTF-8 chunk（可能切在行中间），把每个完整 `data:` 行解析成 JSON 事件交给 `onEvent`。
 *
 * 非 `data:` 行与 `[DONE]` 静默跳过；JSON 解析失败计入诊断（不抛，由 finish 断言）。
 */
export function feedSseJsonEvents(state: SseParseDiagnostics & { readonly buffer: string }, chunk: string, onEvent: (event: Record<string, unknown>) => void): void {
  feedSseLines(state, chunk, (line) => {
    const payload = parseSseDataLine(line);
    if (payload == null || payload === "[DONE]") {
      return;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      recordMalformedSseLine(state, payload);
      return;
    }
    onEvent(event);
  });
}
