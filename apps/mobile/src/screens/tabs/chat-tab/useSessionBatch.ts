/**
 * Session stream batch 单元：wire queue + apply buffer。
 *
 * 从 {@link useChatStreamRuntime} 拆出来的纯数据流单元——只关心怎么把
 * 高频 delta 合并、节流，再交给调用方注入的 `applySegments` 叶子下发。
 * 这一层不订阅 bus、不持有 uiRunning，也不知道 webview / streamingText 的存在——
 * 路由（webview pushStreamBatch / pushStreamDelta vs streamingText 回退）
 * 全部由 stream 单元通过 `applySegments` 注入决定。
 *
 * stream 单元通过 {@link ingestWireChunk} 把 wire chunk 投进来即可。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createStreamApplyBuffer } from '@/services/stream-apply-buffer';
import {
  appendWireChunk,
  coalesceWireQueue,
  type StreamWireChunk,
} from '@/services/stream-wire-queue';

const INGRESS_COALESCE_MS = 32;

export type UseSessionBatchParams = {
  /**
   * apply 叶子：把合并后的 segments 下发到 webview 或 streamingText。
   * 由 stream 单元注入（持有 webview ref / batchEnabled / state setters）。
   */
  applySegments: (segments: readonly StreamWireChunk[]) => void;
};

export type UseSessionBatchResult = {
  /** stream 单元的 delta 入口：写入 ingress queue，触发 32ms 合并 + 64ms apply。 */
  ingestWireChunk(chunk: StreamWireChunk): void;
  /** 清空 ingress queue + apply buffer（stream reset / stream end 时调用）。 */
  clearBuffers(): void;
  /**
   * 手动冲刷：ingress queue 合并进 apply buffer 后立即 flush 下发。
   * STEP_COMMITTED / RUN_FINISHED / RUN_FAILED 等边界事件前调用，
   * 保证缓冲里的 delta 先于落库 reload 到达，不被后续 clear 丢弃。
   */
  flushBuffers(): void;
};

/**
 * 把高频 delta 先丢进 32ms 合并 queue，再过 64ms apply buffer，
 * 最后交调用方注入的 applySegments 叶子下发。
 */
export function useSessionBatch({
  applySegments,
}: UseSessionBatchParams): UseSessionBatchResult {
  // applySegments 用 ref 持有最新实现，避免回调变化导致 buffer / queue 重建。
  const applySegmentsRef = useRef(applySegments);
  applySegmentsRef.current = applySegments;

  const applyLeaf = useCallback((segments: StreamWireChunk[]) => {
    if (segments.length === 0) {
      return;
    }
    applySegmentsRef.current(segments);
  }, []);

  const applyBuffer = useMemo(
    () => createStreamApplyBuffer(applyLeaf, { flushIntervalMs: 64 }),
    [applyLeaf],
  );

  const ingressQueueRef = useRef<StreamWireChunk[]>([]);
  const ingressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushIngressToApplyBuffer = useCallback(() => {
    ingressTimerRef.current = null;
    if (ingressQueueRef.current.length === 0) {
      return;
    }
    const coalesced = coalesceWireQueue(ingressQueueRef.current);
    ingressQueueRef.current = [];
    applyBuffer.pushAll(coalesced);
  }, [applyBuffer]);

  const scheduleIngressFlush = useCallback(() => {
    if (ingressTimerRef.current != null) {
      return;
    }
    ingressTimerRef.current = setTimeout(
      flushIngressToApplyBuffer,
      INGRESS_COALESCE_MS,
    );
  }, [flushIngressToApplyBuffer]);

  const ingestWireChunk = useCallback(
    (chunk: StreamWireChunk) => {
      appendWireChunk(ingressQueueRef.current, chunk);
      scheduleIngressFlush();
    },
    [scheduleIngressFlush],
  );

  const clearBuffers = useCallback(() => {
    if (ingressTimerRef.current != null) {
      clearTimeout(ingressTimerRef.current);
      ingressTimerRef.current = null;
    }
    ingressQueueRef.current = [];
    applyBuffer.reset();
  }, [applyBuffer]);

  const flushBuffers = useCallback(() => {
    // 先取消 ingress 的 32ms 合并 timer 并把队列压进 apply buffer，
    // 再手动 flush 绕过 64ms 节流——两段缓冲一次清空，同步下发。
    if (ingressTimerRef.current != null) {
      clearTimeout(ingressTimerRef.current);
      flushIngressToApplyBuffer();
    }
    applyBuffer.flush();
  }, [flushIngressToApplyBuffer, applyBuffer]);

  // applyBuffer 自带定时器，组件卸载时一并清掉。
  useEffect(() => {
    return () => {
      applyBuffer.dispose();
      if (ingressTimerRef.current != null) {
        clearTimeout(ingressTimerRef.current);
      }
    };
  }, [applyBuffer]);

  return { ingestWireChunk, clearBuffers, flushBuffers };
}
