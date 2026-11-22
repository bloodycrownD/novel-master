/**
 * 64ms FIFO apply 缓冲：按 wire 到达序 flush，溢出时强制 flush 且不丢弃 thinking。
 */
import type {StreamWireChunk} from './stream-wire-queue';
import {StreamWireQueue} from './stream-wire-queue';

type StreamApplyBufferOptions = {
    readonly flushIntervalMs?: number;
    readonly maxCharsPerBuffer?: number;
};

/** apply 缓冲的 flush 回调形状（create 首参）。 */
type StreamApplyFlushFn = (segments: StreamWireChunk[]) => void;

/** apply 缓冲的共享状态槽：queue 是稳定引用（只 splice/push 内容变异），timer 是重绑游标。 */
type StreamApplyBufferSlot = {
    queue: StreamWireChunk[];
    timer: ReturnType<typeof setTimeout> | null;
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

export namespace StreamApplyBuffer {
    function clearTimer(slot: StreamApplyBufferSlot): void {
        if (slot.timer != null) {
            clearTimeout(slot.timer);
            slot.timer = null;
        }
    }

    /** 取空队列并按到达序交给 onFlush（splice 取空是引用变异非重绑）。 */
    function flush(slot: StreamApplyBufferSlot, onFlush: StreamApplyFlushFn): void {
        clearTimer(slot);
        if (slot.queue.length === 0) {
            return;
        }
        const segments = slot.queue.splice(0, slot.queue.length);
        onFlush(segments);
    }

    function schedule(slot: StreamApplyBufferSlot, onFlush: StreamApplyFlushFn, flushIntervalMs: number): void {
        if (slot.timer != null) {
            return;
        }
        slot.timer = setTimeout(() => flush(slot, onFlush), flushIntervalMs);
    }

    function maybeForceFlushOnOverflow(slot: StreamApplyBufferSlot, onFlush: StreamApplyFlushFn, maxCharsPerBuffer: number): void {
        if (StreamWireQueue.charCount(slot.queue) > maxCharsPerBuffer) {
            flush(slot, onFlush);
        }
    }

    function push(slot: StreamApplyBufferSlot, onFlush: StreamApplyFlushFn, flushIntervalMs: number, maxCharsPerBuffer: number, chunk: StreamWireChunk): void {
        if (chunk.delta.length === 0) {
            return;
        }
        slot.queue.push({kind: chunk.kind, delta: chunk.delta});
        maybeForceFlushOnOverflow(slot, onFlush, maxCharsPerBuffer);
        if (slot.queue.length > 0) {
            schedule(slot, onFlush, flushIntervalMs);
        }
    }

    function pushAll(slot: StreamApplyBufferSlot, onFlush: StreamApplyFlushFn, flushIntervalMs: number, maxCharsPerBuffer: number, chunks: readonly StreamWireChunk[]): void {
        for (const chunk of chunks) {
            if (chunk.delta.length === 0) {
                continue;
            }
            slot.queue.push({kind: chunk.kind, delta: chunk.delta});
        }
        if (slot.queue.length === 0) {
            return;
        }
        maybeForceFlushOnOverflow(slot, onFlush, maxCharsPerBuffer);
        schedule(slot, onFlush, flushIntervalMs);
    }

    export function create(onFlush: StreamApplyFlushFn, options?: StreamApplyBufferOptions): StreamApplyBuffer {
        const flushIntervalMs = options?.flushIntervalMs ?? 64;
        const maxCharsPerBuffer = options?.maxCharsPerBuffer ?? 4_096;
        const slot: StreamApplyBufferSlot = {queue: [], timer: null};

        return {
            push: chunk => push(slot, onFlush, flushIntervalMs, maxCharsPerBuffer, chunk),
            pushAll: chunks => pushAll(slot, onFlush, flushIntervalMs, maxCharsPerBuffer, chunks),
            flush: () => flush(slot, onFlush),
            reset() {
                clearTimer(slot);
                slot.queue.length = 0;
            },
            dispose() {
                clearTimer(slot);
                slot.queue.length = 0;
            },
        };
    }
}
