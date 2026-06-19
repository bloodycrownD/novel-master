/**
 * 64ms FIFO apply 缓冲：按 wire 到达序 flush，溢出时强制 flush 且不丢弃 thinking。
 */
import type {StreamWireChunk} from '@/services/stream-wire-queue';
import {wireQueueCharCount} from '@/services/stream-wire-queue';

export type StreamApplyBufferOptions = {
  readonly flushIntervalMs?: number;
  readonly maxCharsPerBuffer?: number;
};

export type StreamApplyBuffer = {
  /** 追加单段（保序 FIFO）。 */
  push: (chunk: StreamWireChunk) => void;
  /** 批量追加（段间顺序不变）。 */
  pushAll: (chunks: readonly StreamWireChunk[]) => void;
  flush: () => void;
  reset: () => void;
  dispose: () => void;
};

export function createStreamApplyBuffer(
  onFlush: (segments: StreamWireChunk[]) => void,
  options?: StreamApplyBufferOptions,
): StreamApplyBuffer {
  const flushIntervalMs = options?.flushIntervalMs ?? 64;
  const maxCharsPerBuffer = options?.maxCharsPerBuffer ?? 4_096;
  const queue: StreamWireChunk[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    clearTimer();
    if (queue.length === 0) {
      return;
    }
    const segments = queue.splice(0, queue.length);
    onFlush(segments);
  };

  const schedule = () => {
    if (timer != null) {
      return;
    }
    timer = setTimeout(flush, flushIntervalMs);
  };

  const maybeForceFlushOnOverflow = () => {
    if (wireQueueCharCount(queue) > maxCharsPerBuffer) {
      flush();
    }
  };

  const push = (chunk: StreamWireChunk) => {
    if (chunk.delta.length === 0) {
      return;
    }
    queue.push({kind: chunk.kind, delta: chunk.delta});
    maybeForceFlushOnOverflow();
    if (queue.length > 0) {
      schedule();
    }
  };

  const pushAll = (chunks: readonly StreamWireChunk[]) => {
    for (const chunk of chunks) {
      if (chunk.delta.length === 0) {
        continue;
      }
      queue.push({kind: chunk.kind, delta: chunk.delta});
    }
    if (queue.length === 0) {
      return;
    }
    maybeForceFlushOnOverflow();
    schedule();
  };

  return {
    push,
    pushAll,
    flush,
    reset() {
      clearTimer();
      queue.length = 0;
    },
    dispose() {
      clearTimer();
      queue.length = 0;
    },
  };
}
