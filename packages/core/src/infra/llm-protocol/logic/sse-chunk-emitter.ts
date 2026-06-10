/**
 * Fixed-interval SSE chunk emitter for React Native XHR transport.
 *
 * XHR `onprogress` can deliver large `responseText` slices in a single callback.
 * Emitting each slice synchronously via `onChunk` starves the RN JS event loop.
 * This module buffers incoming text and invokes `onChunk` at most once per tick
 * (default 32ms), smoothing burst delivery without capping throughput.
 *
 * Invariants:
 * - `append()` never calls `onChunk`
 * - Each tick emits the entire buffer as one chunk, then clears the buffer
 * - `flush()` stops the interval, returns remaining buffer, and zeros it (caller may `onChunk`)
 * - `dispose()` stops the interval and discards any un-emitted buffer
 *
 * @module infra/llm-protocol/logic/sse-chunk-emitter
 */

export const DEFAULT_TICK_MS = 32;

export interface SseChunkEmitter {
  /** Append XHR slice; does not call onChunk. */
  append(text: string): void;
  /** Stop tick; return and clear buffer (caller may onChunk synchronously). */
  flush(): string;
  /** Stop tick and discard un-emitted buffer (error/abort paths). */
  dispose(): void;
}

export function createSseChunkEmitter(
  onChunk: (chunk: string) => void,
  options?: { tickMs?: number },
): SseChunkEmitter {
  const tickMs = options?.tickMs ?? DEFAULT_TICK_MS;
  let buffer = "";
  let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    if (buffer.length === 0) {
      return;
    }
    const chunk = buffer;
    buffer = "";
    onChunk(chunk);
  }, tickMs);

  const stopTimer = (): void => {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    append(text: string): void {
      buffer += text;
    },

    flush(): string {
      stopTimer();
      const tail = buffer;
      buffer = "";
      return tail;
    },

    dispose(): void {
      stopTimer();
      buffer = "";
    },
  };
}
