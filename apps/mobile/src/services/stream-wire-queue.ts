/**
 * FIFO 流式 wire 队列：保序写入 thinking / 正文分区，相邻同 kind 可合并。
 */

export type StreamWireKind = 'text' | 'thinking';

export type StreamWireChunk = {
  readonly kind: StreamWireKind;
  readonly delta: string;
};

/** 追加 wire 块；与队尾同 kind 时合并 delta，禁止 kind 重排。 */
export function appendWireChunk(
  queue: StreamWireChunk[],
  chunk: StreamWireChunk,
): void {
  if (chunk.delta.length === 0) {
    return;
  }
  const last = queue[queue.length - 1];
  if (last != null && last.kind === chunk.kind) {
    queue[queue.length - 1] = {
      kind: chunk.kind,
      delta: last.delta + chunk.delta,
    };
    return;
  }
  queue.push({kind: chunk.kind, delta: chunk.delta});
}

/** 合并队列中相邻同 kind 段，返回新数组（输入顺序不变）。 */
export function coalesceWireQueue(
  queue: readonly StreamWireChunk[],
): StreamWireChunk[] {
  if (queue.length === 0) {
    return [];
  }
  const out: StreamWireChunk[] = [{...queue[0]}];
  for (let i = 1; i < queue.length; i++) {
    const chunk = queue[i]!;
    const prev = out[out.length - 1]!;
    if (prev.kind === chunk.kind) {
      out[out.length - 1] = {
        kind: prev.kind,
        delta: prev.delta + chunk.delta,
      };
    } else {
      out.push({...chunk});
    }
  }
  return out;
}

/** 队列内字符总数（用于溢出判定）。 */
export function wireQueueCharCount(queue: readonly StreamWireChunk[]): number {
  let total = 0;
  for (const chunk of queue) {
    total += chunk.delta.length;
  }
  return total;
}
