/**
 * 流式正文 delta 直通辅助。
 *
 * 思考内容仅来自结构化协议字段（OpenAI `reasoning_content`、Gemini `thought: true`），
 * 不对 `content` / 非 thought 正文做内嵌标签挖掘或清洗。
 *
 * @module infra/llm-protocol/logic/inline-thinking-parser
 */

import type { LlmStreamEvent } from "../ports/adapter.port.js";

/**
 * 将正文 delta 原样写入累加器并发出 `text-delta`。
 * 不做 per-chunk 内嵌 thinking 拆分。
 */
export function emitDirectTextDelta(
  state: { textParts: string[] },
  text: string,
  onStream?: (event: LlmStreamEvent) => void,
): void {
  if (text === "") {
    return;
  }
  state.textParts.push(text);
  onStream?.({ type: "text-delta", text });
}
