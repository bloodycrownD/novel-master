/**
 * Shared SSE line splitting for incremental UTF-8 chunk feeds.
 *
 * @module infra/llm-protocol/logic/sse-line-buffer
 */

/** Mutable buffer holder shared by protocol SSE parsers. */
type SseLineBufferState = { readonly buffer: string };

export const SseLineBuffer = {
  /**
   * Append a chunk, invoke `onLine` for each complete line, retain trailing fragment.
   */
  feed(state: SseLineBufferState, chunk: string, onLine: (line: string) => void): void {
    const combined = state.buffer + chunk;
    const lines = combined.split("\n");
    const trailing = lines.pop() ?? "";
    for (const line of lines) {
      onLine(line);
    }
    (state as { buffer: string }).buffer = trailing;
  },

  /**
   * Flush a trailing fragment (stream end / abort) by feeding one terminating newline.
   *
   * The fragment may be a complete `data:` line that arrived without its `\n`
   * because a chunk boundary or an abort fell between payload and terminator.
   */
  drain(state: SseLineBufferState, feed: (chunk: string) => void): void {
    if (state.buffer !== "") {
      feed("\n");
    }
  },
} as const;
