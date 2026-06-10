/**
 * Shared SSE line splitting for incremental UTF-8 chunk feeds.
 *
 * @module infra/llm-protocol/logic/sse-line-buffer
 */

/** Mutable buffer holder shared by protocol SSE parsers. */
export type SseLineBufferState = { readonly buffer: string };

/**
 * Append a chunk, invoke `onLine` for each complete line, retain trailing fragment.
 */
export function feedSseLines(
  state: SseLineBufferState,
  chunk: string,
  onLine: (line: string) => void,
): void {
  const combined = state.buffer + chunk;
  const lines = combined.split("\n");
  const trailing = lines.pop() ?? "";
  for (const line of lines) {
    onLine(line);
  }
  (state as { buffer: string }).buffer = trailing;
}
