/**
 * Session stream 单元：bus 事件订阅 + streamingText/streamingThinking state + stale 守卫。
 *
 * 从 {@link useChatStreamRuntime} 拆出来的事件源单元——独占 Bus 订阅，
 * 负责把 RUN_STARTED / STREAM_TEXT/THINKING_DELTA / STEP_COMMITTED /
 * RUN_FINISHED / RUN_FAILED 派发到对应的 lifecycle / abort / batch 入口。
 *
 * 不直接依赖 abort 单元或 lifecycle 单元——所有守卫 / 回调由 Provider 注入：
 * - lifecycle 守卫：acceptRunEvent / onRunStarted / onRunFinished / onRunFailed；
 * - abort 守卫：getUiRunning / getTranscriptFreezeCount / getAbortRetainPending / clearAbortRetainPending；
 * - batch 入口：ingestWireChunk / clearBuffers。
 *
 * 注意：refcount 归属 lifecycle 单元——本单元的 FINISHED/FAILED 不再直接
 * decrementAgentActive，改为通知 lifecycle（onRunFinished/onRunFailed）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  type AgentRunFailedPayload,
  type AgentRunFinishedPayload,
  type AgentRunStartedPayload,
  type AgentStepCommittedPayload,
  type AgentStreamTextDeltaPayload,
  type AgentStreamThinkingDeltaPayload,
  type AgentStreamToolUsePayload,
} from '@novel-master/core/events';
import { shouldApplyTranscriptReload } from '@novel-master/core/agent';
import type { ChatTranscriptWebViewHandle } from '@/components/chat/ChatTranscriptWebView';
import {
  flushAgentStepUi,
  flushRunUi,
  type FlushMessagesChanged,
  type FlushStreamEndContext,
} from '@/components/chat/flush-run-ui';
import { useStreamMetricsAcc } from '@/hooks/useAgentStreamMetrics';
import { useRuntime } from '@/hooks/useRuntime';
import type { StreamWireChunk } from '@/services/stream-wire-queue';

export type UseSessionStreamParams = {
  sessionId: string | undefined;
  /** 是否走 webview 转录引擎；stream end / reset / apply 路由都据此决定。 */
  useWebviewTranscript: boolean;
  /** webview 路径下是否合并为 pushStreamBatch；false 走 pushStreamDelta 逐条保序。 */
  batchEnabled: boolean;
  transcriptWebRef: RefObject<ChatTranscriptWebViewHandle | null>;
  /** uiRunning state（来自 abort 单元），用于驱动 stream metrics acc。 */
  uiRunning: boolean;
  // lifecycle 守卫（注入）
  acceptRunEvent: (runId: string | undefined) => boolean;
  onRunStarted: (payload: AgentRunStartedPayload) => void;
  onRunFinished?: (payload: AgentRunFinishedPayload) => void;
  onRunFailed?: (payload: AgentRunFailedPayload) => void;
  // abort 守卫（注入）
  getUiRunning: () => boolean;
  getTranscriptFreezeCount: () => number | null;
  getAbortRetainPending: () => boolean;
  clearAbortRetainPending: () => void;
  // batch 入口（注入）
  batchIngest: (chunk: StreamWireChunk) => void;
  batchClear: () => void;
  /** 边界事件（STEP_COMMITTED / RUN_FINISHED / RUN_FAILED）前手动冲刷 batch 缓冲。 */
  batchFlush: () => void;
  // messages
  onMessagesChanged: FlushMessagesChanged;
  getMessageCount: () => number;
  onStepCommitted?: (payload: AgentStepCommittedPayload) => void;
};

export type UseSessionStreamResult = {
  streamingText: string;
  streamingThinking: string;
  /** 清空 batch buffer + 重置 stream state（webview resetStream 或 state 清空）。 */
  handleStreamReset: () => void;
  /** 仅清空 streamingText/Thinking state（legacy 路径专用）。 */
  resetStreamingDisplay: () => void;
  /**
   * apply 叶子：batch 单元调它下发合并后的 segments。
   * 路由 webview（pushStreamBatch / pushStreamDelta）vs streamingText 回退。
   */
  applySegments(segments: readonly StreamWireChunk[]): void;
  streamMetricsAccRef: ReturnType<typeof useStreamMetricsAcc>['accRef'];
  streamMetricsLastRun: ReturnType<typeof useStreamMetricsAcc>['lastRun'];
};

export function useSessionStream({
  sessionId,
  useWebviewTranscript,
  batchEnabled,
  transcriptWebRef,
  uiRunning,
  acceptRunEvent,
  onRunStarted,
  onRunFinished,
  onRunFailed,
  getUiRunning,
  getTranscriptFreezeCount,
  getAbortRetainPending,
  clearAbortRetainPending,
  batchIngest,
  batchClear,
  batchFlush,
  onMessagesChanged,
  getMessageCount,
  onStepCommitted,
}: UseSessionStreamParams): UseSessionStreamResult {
  const runtime = useRuntime();
  const [streamingText, setStreamingText] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');

  const {
    accRef: streamMetricsAccRef,
    lastRun: streamMetricsLastRun,
    noteTextDelta: noteMetricsTextDelta,
    noteThinkingDelta: noteMetricsThinkingDelta,
  } = useStreamMetricsAcc(uiRunning);

  const useWebviewRef = useRef(useWebviewTranscript);
  useWebviewRef.current = useWebviewTranscript;
  const batchEnabledRef = useRef(batchEnabled);
  batchEnabledRef.current = batchEnabled;
  const transcriptWebRefRef = useRef(transcriptWebRef);
  transcriptWebRefRef.current = transcriptWebRef;

  // 所有注入回调用 ref 持有最新值，bus 订阅 effect 不依赖它们重建。
  const lifecycleRef = useRef({
    acceptRunEvent,
    onRunStarted,
    onRunFinished,
    onRunFailed,
  });
  lifecycleRef.current = {
    acceptRunEvent,
    onRunStarted,
    onRunFinished,
    onRunFailed,
  };

  const callbacksRef = useRef({ onMessagesChanged, onStepCommitted });
  callbacksRef.current = { onMessagesChanged, onStepCommitted };

  const abortGuardsRef = useRef({
    getUiRunning,
    getTranscriptFreezeCount,
    getAbortRetainPending,
    clearAbortRetainPending,
  });
  abortGuardsRef.current = {
    getUiRunning,
    getTranscriptFreezeCount,
    getAbortRetainPending,
    clearAbortRetainPending,
  };

  const metricsRef = useRef({ noteMetricsTextDelta, noteMetricsThinkingDelta });
  metricsRef.current = { noteMetricsTextDelta, noteMetricsThinkingDelta };

  const batchIngestRef = useRef(batchIngest);
  batchIngestRef.current = batchIngest;
  const batchClearRef = useRef(batchClear);
  batchClearRef.current = batchClear;
  const batchFlushRef = useRef(batchFlush);
  batchFlushRef.current = batchFlush;
  // abort fallback commit：内部定义后赋值（见下），这里占位。
  const commitAbortOverlayRef = useRef<() => Promise<void>>(async () => undefined);

  const getMessageCountRef = useRef(getMessageCount);
  getMessageCountRef.current = getMessageCount;

  /** 本 run 内已成功 streamCommit 的消息 id，防止 step + RUN_FINISHED 双次提交。 */
  const committedTailIdsRef = useRef<Set<string>>(new Set());

  /** apply 叶子：webview 路径调 pushStreamBatch/Delta，非 webview 回退到 state。 */
  const applySegments = useCallback((segments: readonly StreamWireChunk[]) => {
    if (segments.length === 0) {
      return;
    }
    if (useWebviewRef.current) {
      const web = transcriptWebRefRef.current.current;
      if (web == null) {
        return;
      }
      if (batchEnabledRef.current) {
        web.pushStreamBatch({ segments });
      } else {
        for (const seg of segments) {
          web.pushStreamDelta(seg.kind, seg.delta);
        }
      }
      return;
    }
    for (const seg of segments) {
      if (seg.kind === 'text') {
        setStreamingText(s => s + seg.delta);
      } else {
        setStreamingThinking(s => s + seg.delta);
      }
    }
  }, []);

  const handleIngressText = useCallback(
    (delta: string) => {
      if (delta.length === 0) {
        return;
      }
      metricsRef.current.noteMetricsTextDelta(delta);
      batchIngestRef.current({ kind: 'text', delta });
    },
    [],
  );

  const handleIngressThinking = useCallback(
    (delta: string) => {
      if (delta.length === 0) {
        return;
      }
      metricsRef.current.noteMetricsThinkingDelta(delta);
      batchIngestRef.current({ kind: 'thinking', delta });
    },
    [],
  );

  const handleStreamEndAfterReload = useCallback(
    ({ messages, prevCount }: FlushStreamEndContext) => {
      batchClearRef.current();
      const added = messages.slice(prevCount);
      if (added.length === 0) {
        if (committedTailIdsRef.current.size > 0) {
          return;
        }
        if (useWebviewRef.current) {
          transcriptWebRefRef.current.current?.resetStream();
        } else {
          setStreamingText('');
          setStreamingThinking('');
        }
        return;
      }
      const addedIds = added.map(message => message.id);
      const alreadyCommitted =
        addedIds.length > 0 &&
        addedIds.every(id => committedTailIdsRef.current.has(id));
      if (alreadyCommitted) {
        return;
      }
      if (useWebviewRef.current) {
        const web = transcriptWebRefRef.current.current;
        const committed = web?.tryCommitStreamTail(messages, prevCount) ?? false;
        if (committed) {
          for (const id of addedIds) {
            committedTailIdsRef.current.add(id);
          }
          return;
        }
        web?.resetStream();
        return;
      }
      setStreamingText('');
      setStreamingThinking('');
    },
    [],
  );

  const handleStreamReset = useCallback(() => {
    batchClearRef.current();
    if (useWebviewRef.current) {
      transcriptWebRefRef.current.current?.resetStream();
    } else {
      setStreamingText('');
      setStreamingThinking('');
    }
  }, []);

  const resetStreamingDisplay = useCallback(() => {
    setStreamingText('');
    setStreamingThinking('');
  }, []);

  // abort 时 commit 半成品 stream：webview 路径调 commitAbortOverlaySnapshot；
  // legacy 路径仅检测 state 是否非空（保持原行为）。
  const commitAbortOverlay = useCallback(async (): Promise<void> => {
    if (useWebviewRef.current) {
      transcriptWebRefRef.current.current?.commitAbortOverlaySnapshot();
      return;
    }
    if (streamingText.length === 0 && streamingThinking.length === 0) {
      return;
    }
  }, [streamingText, streamingThinking]);

  // bus 订阅 effect 不依赖 commitAbortOverlay 重建——用 ref 持有最新实现，
  // 避免 streamingText 变化导致整个订阅 effect 重建。
  commitAbortOverlayRef.current = commitAbortOverlay;

  useEffect(() => {
    if (sessionId == null) {
      return undefined;
    }
    const sid = sessionId;
    const bus = runtime.eventBus;

    const subStarted = bus.subscribe(
      EVENT_AGENT_RUN_STARTED,
      (payload: AgentRunStartedPayload) => {
        if (payload.sessionId !== sid) {
          return;
        }
        committedTailIdsRef.current.clear();
        lifecycleRef.current.onRunStarted(payload);
      },
    );
    const subText = bus.subscribe(
      EVENT_AGENT_STREAM_TEXT_DELTA,
      (payload: AgentStreamTextDeltaPayload) => {
        if (payload.sessionId !== sid) {
          return;
        }
        if (!lifecycleRef.current.acceptRunEvent(payload.runId)) {
          return;
        }
        if (!abortGuardsRef.current.getUiRunning()) {
          return;
        }
        handleIngressText(payload.text);
      },
    );
    const subThinking = bus.subscribe(
      EVENT_AGENT_STREAM_THINKING_DELTA,
      (payload: AgentStreamThinkingDeltaPayload) => {
        if (payload.sessionId !== sid) {
          return;
        }
        if (!lifecycleRef.current.acceptRunEvent(payload.runId)) {
          return;
        }
        if (!abortGuardsRef.current.getUiRunning()) {
          return;
        }
        handleIngressThinking(payload.text);
      },
    );
    const subToolUse = bus.subscribe(
      EVENT_AGENT_STREAM_TOOL_USE,
      (payload: AgentStreamToolUsePayload) => {
        if (payload.sessionId !== sid) {
          return;
        }
        lifecycleRef.current.acceptRunEvent(payload.runId);
      },
    );
    const subStep = bus.subscribe(
      EVENT_AGENT_STEP_COMMITTED,
      (payload: AgentStepCommittedPayload) => {
        if (payload.sessionId !== sid) {
          return;
        }
        if (!lifecycleRef.current.acceptRunEvent(payload.runId)) {
          return;
        }
        // step commit 前 batch 里可能还残留 delta，先 flush 避免被后续 reload/clear 丢弃
        // （对齐 desktop useAgentStream 的「先 flush 再回调」模式，插入点钉死在
        // acceptRunEvent 守卫后、phase 分支前，tool_results / assistant 两分支都覆盖）。
        batchFlushRef.current();
        const uiRunning = abortGuardsRef.current.getUiRunning();
        const freezeCount = abortGuardsRef.current.getTranscriptFreezeCount();
        const cb = callbacksRef.current;
        if (payload.phase === 'tool_results') {
          if (!shouldApplyTranscriptReload(uiRunning, freezeCount)) {
            return;
          }
          void Promise.resolve(
            cb.onMessagesChanged({ immediate: true }),
          ).catch(() => undefined);
          return;
        }
        const allowAssistantReload = shouldApplyTranscriptReload(
          uiRunning,
          freezeCount,
          {
            abortRetainPending: abortGuardsRef.current.getAbortRetainPending(),
            phase: 'assistant',
          },
        );
        if (!allowAssistantReload) {
          return;
        }
        const abortRetainReload = abortGuardsRef.current.getAbortRetainPending();
        void flushAgentStepUi(
          payload.phase,
          cb.onMessagesChanged,
          handleStreamEndAfterReload,
          getMessageCountRef.current(),
        )
          .then(() => {
            cb.onStepCommitted?.(payload);
          })
          .catch(() => undefined)
          .finally(() => {
            if (abortRetainReload) {
              abortGuardsRef.current.clearAbortRetainPending();
              handleStreamReset();
            }
          });
      },
    );
    const subFinished = bus.subscribe(
      EVENT_AGENT_RUN_FINISHED,
      (payload: AgentRunFinishedPayload) => {
        if (payload.sessionId !== sid) {
          return;
        }
        if (!lifecycleRef.current.acceptRunEvent(payload.runId)) {
          return;
        }
        // run 结束前先 flush，保证缓冲 delta 先于 flushRunUi 的 reload/clear 到达。
        batchFlushRef.current();
        // refcount 归属 lifecycle 单元——这里只通知 lifecycle，不直接 decrement。
        const uiRunning = abortGuardsRef.current.getUiRunning();
        const freezeCount = abortGuardsRef.current.getTranscriptFreezeCount();
        const cb = callbacksRef.current;
        const finishRun = () =>
          lifecycleRef.current.onRunFinished?.(payload);
        if (abortGuardsRef.current.getAbortRetainPending()) {
          void commitAbortOverlayRef
            .current()
            .catch(() => undefined)
            .finally(() => {
              abortGuardsRef.current.clearAbortRetainPending();
              handleStreamReset();
              finishRun();
            });
          return;
        }
        if (shouldApplyTranscriptReload(uiRunning, freezeCount)) {
          void flushRunUi(
            cb.onMessagesChanged,
            handleStreamEndAfterReload,
            getMessageCountRef.current(),
          )
            .catch(() => undefined)
            .finally(finishRun);
          return;
        }
        handleStreamReset();
        finishRun();
      },
    );
    const subFailed = bus.subscribe(
      EVENT_AGENT_RUN_FAILED,
      (payload: AgentRunFailedPayload) => {
        if (payload.sessionId !== sid) {
          return;
        }
        if (!lifecycleRef.current.acceptRunEvent(payload.runId)) {
          return;
        }
        // run 失败前同样先 flush，失败路径的 reload/clear 不应吞掉已到达的 delta。
        batchFlushRef.current();
        // refcount 归属 lifecycle 单元——这里只通知 lifecycle，不直接 decrement。
        const uiRunning = abortGuardsRef.current.getUiRunning();
        const freezeCount = abortGuardsRef.current.getTranscriptFreezeCount();
        const cb = callbacksRef.current;
        const failRun = () => lifecycleRef.current.onRunFailed?.(payload);
        if (shouldApplyTranscriptReload(uiRunning, freezeCount)) {
          flushRunUi(
            cb.onMessagesChanged,
            handleStreamEndAfterReload,
            getMessageCountRef.current(),
          )
            .then(failRun)
            .catch(() => undefined);
          return;
        }
        handleStreamReset();
        failRun();
      },
    );

    return () => {
      subStarted.unsubscribe();
      subText.unsubscribe();
      subThinking.unsubscribe();
      subToolUse.unsubscribe();
      subStep.unsubscribe();
      subFinished.unsubscribe();
      subFailed.unsubscribe();
    };
  }, [
    runtime.eventBus,
    sessionId,
    handleIngressText,
    handleIngressThinking,
    handleStreamEndAfterReload,
    handleStreamReset,
  ]);

  return {
    streamingText,
    streamingThinking,
    handleStreamReset,
    resetStreamingDisplay,
    applySegments,
    streamMetricsAccRef,
    streamMetricsLastRun,
  };
}
