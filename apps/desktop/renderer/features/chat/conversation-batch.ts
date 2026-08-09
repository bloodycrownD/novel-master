/**
 * Batch 单元（renderer 层 buffer）—— Phase 3 Step 21。
 *
 * Desktop 之前没有 batch，从零新建。意图是把高频 text / thinking delta
 * 在写入 React state 之前用 requestAnimationFrame 合并，避免每个 delta
 * 都触发一次 setState + 重渲染。
 *
 * 形态是一个返回 sink 的 hook：消费方（useAgentStream）拿到 pushTextDelta
 * / pushThinkingDelta 后塞 delta 进来；buffer 在下一帧 flush，回调
 * onTextFlush / onThinkingFlush 把累计的文本写回 state。
 *
 * enabled=false 时退化为直通——push 立即调 flush 回调，不走 RAF。
 *
 * 与 Mobile 的 useSessionBatch（wire queue + apply buffer 双路径）不同，
 * Desktop 没有 wire 通道，这里只是单纯的 renderer 层 RAF 合并。
 */
import { useCallback, useEffect, useRef } from "react";

export interface ConversationBatchSink {
  pushTextDelta(delta: string): void;
  pushThinkingDelta(delta: string): void;
  /** 立刻把 buffer 里的剩余 delta 冲到回调（step commit / run 结束前调）。 */
  flush(): void;
  /** 丢弃 buffer 里还没 flush 的内容（abort / 切会话用）。 */
  reset(): void;
}

export interface UseConversationBatchOptions {
  readonly enabled: boolean;
  readonly onTextFlush: (delta: string) => void;
  readonly onThinkingFlush: (delta: string) => void;
}

export function useConversationBatch(
  options: UseConversationBatchOptions,
): ConversationBatchSink {
  const { enabled, onTextFlush, onThinkingFlush } = options;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const textBufRef = useRef("");
  const thinkingBufRef = useRef("");
  const rafIdRef = useRef<number | null>(null);

  // flush 回调存 ref：每帧拿最新的 onTextFlush / onThinkingFlush，不用重排 RAF。
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    const text = textBufRef.current;
    const thinking = thinkingBufRef.current;
    textBufRef.current = "";
    thinkingBufRef.current = "";
    if (text.length > 0) {
      onTextFlush(text);
    }
    if (thinking.length > 0) {
      onThinkingFlush(thinking);
    }
  };

  const cancelRaf = useCallback(() => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const schedule = useCallback(() => {
    if (rafIdRef.current != null) {
      return;
    }
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      flushRef.current();
    });
  }, []);

  // 卸载时把挂着的 RAF 取消，避免离开会话后还在写老 state。
  useEffect(() => {
    return () => {
      cancelRaf();
    };
  }, [cancelRaf]);

  const pushTextDelta = useCallback(
    (delta: string) => {
      if (!enabledRef.current) {
        onTextFlush(delta);
        return;
      }
      textBufRef.current += delta;
      schedule();
    },
    [onTextFlush, schedule],
  );

  const pushThinkingDelta = useCallback(
    (delta: string) => {
      if (!enabledRef.current) {
        onThinkingFlush(delta);
        return;
      }
      thinkingBufRef.current += delta;
      schedule();
    },
    [onThinkingFlush, schedule],
  );

  const flush = useCallback(() => {
    cancelRaf();
    flushRef.current();
  }, [cancelRaf]);

  const reset = useCallback(() => {
    cancelRaf();
    textBufRef.current = "";
    thinkingBufRef.current = "";
  }, [cancelRaf]);

  return { pushTextDelta, pushThinkingDelta, flush, reset };
}
