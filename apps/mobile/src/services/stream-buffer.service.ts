/**
 * Buffer stream deltas and flush batched updates to UI.
 */
type StreamKind = 'text' | 'thinking';

export interface StreamBufferOptions {
  readonly flushIntervalMs?: number;
  readonly maxCharsPerBuffer?: number;
  readonly dropThinkingOnOverflow?: boolean;
}

export interface StreamBuffer {
  push(kind: StreamKind, delta: string): void;
  flush(): void;
  reset(): void;
  dispose(): void;
}

export function createStreamBuffer(
  callbacks: {
    onTextFlush: (chunk: string) => void;
    onThinkingFlush: (chunk: string) => void;
  },
  options?: StreamBufferOptions,
): StreamBuffer {
  const flushIntervalMs = options?.flushIntervalMs ?? 40;
  const maxCharsPerBuffer = options?.maxCharsPerBuffer ?? 4_096;
  const dropThinkingOnOverflow = options?.dropThinkingOnOverflow !== false;
  let textBuffer = '';
  let thinkingBuffer = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    clearTimer();
    if (textBuffer.length > 0) {
      callbacks.onTextFlush(textBuffer);
      textBuffer = '';
    }
    if (thinkingBuffer.length > 0) {
      callbacks.onThinkingFlush(thinkingBuffer);
      thinkingBuffer = '';
    }
  };

  const schedule = () => {
    if (timer != null) {
      return;
    }
    timer = setTimeout(() => {
      flush();
    }, flushIntervalMs);
  };

  return {
    push(kind, delta) {
      if (delta.length === 0) {
        return;
      }
      if (kind === 'text') {
        textBuffer += delta;
      } else {
        thinkingBuffer += delta;
      }
      if (textBuffer.length + thinkingBuffer.length > maxCharsPerBuffer) {
        // WHY: thinking text is expendable; keep assistant正文完整优先.
        if (dropThinkingOnOverflow && thinkingBuffer.length > 0) {
          thinkingBuffer = '';
        } else {
          flush();
          return;
        }
      }
      schedule();
    },
    flush,
    reset() {
      clearTimer();
      textBuffer = '';
      thinkingBuffer = '';
    },
    dispose() {
      clearTimer();
      textBuffer = '';
      thinkingBuffer = '';
    },
  };
}
