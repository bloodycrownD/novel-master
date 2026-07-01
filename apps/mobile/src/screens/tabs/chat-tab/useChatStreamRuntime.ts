/**
 * Chat tab 流式 runtime：独占 Bus 订阅，FIFO wire → 64ms apply → 双引擎。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { ChatTranscriptWebViewHandle } from '@/components/chat/ChatTranscriptWebView';
import {
  flushAgentStepUi,
  flushRunUi,
  type FlushMessagesChanged,
  type FlushStreamEndContext,
} from '@/components/chat/flush-run-ui';
import { useStreamMetricsAcc } from '@/hooks/useAgentStreamMetrics';
import { useRuntime } from '@/hooks/useRuntime';
import { decrementAgentActive } from '@/runtime/agent-activity';
import { createStreamApplyBuffer } from '@/services/stream-apply-buffer';
import {
  appendWireChunk,
  coalesceWireQueue,
  type StreamWireChunk,
} from '@/services/stream-wire-queue';

const INGRESS_COALESCE_MS = 32;

export type UseChatStreamRuntimeParams = {
  sessionId: string | undefined;
  uiRunning: boolean;
  useWebviewTranscript: boolean;
  chatStreamBatchEnabled: boolean;
  transcriptWebRef: RefObject<ChatTranscriptWebViewHandle | null>;
  onMessagesChanged: FlushMessagesChanged;
  getMessageCount: () => number;
  onStepCommitted?: (payload: AgentStepCommittedPayload) => void;
  acceptRunEvent: (runId: string | undefined) => boolean;
  onRunStarted: (payload: AgentRunStartedPayload) => void;
  onRunFinished?: (payload: AgentRunFinishedPayload) => void;
  onRunFailed?: (payload: AgentRunFailedPayload) => void;
  noteStreamDelta: () => void;
  resetStreamClock: () => void;
};

export function useChatStreamRuntime({
  sessionId,
  uiRunning,
  useWebviewTranscript,
  chatStreamBatchEnabled,
  transcriptWebRef,
  onMessagesChanged,
  getMessageCount,
  onStepCommitted,
  acceptRunEvent,
  onRunStarted,
  onRunFinished,
  onRunFailed,
  noteStreamDelta,
  resetStreamClock,
}: UseChatStreamRuntimeParams) {
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
  const batchEnabledRef = useRef(chatStreamBatchEnabled);
  batchEnabledRef.current = chatStreamBatchEnabled;
  const transcriptWebRefRef = useRef(transcriptWebRef);
  transcriptWebRefRef.current = transcriptWebRef;

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

  const callbacksRef = useRef({
    onMessagesChanged,
    onStepCommitted,
  });
  callbacksRef.current = {
    onMessagesChanged,
    onStepCommitted,
  };

  const streamClockRef = useRef({ noteStreamDelta, resetStreamClock });
  streamClockRef.current = { noteStreamDelta, resetStreamClock };

  const metricsRef = useRef({
    noteMetricsTextDelta,
    noteMetricsThinkingDelta,
  });
  metricsRef.current = {
    noteMetricsTextDelta,
    noteMetricsThinkingDelta,
  };

  const applySegments = useCallback((segments: StreamWireChunk[]) => {
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

  const applyBuffer = useMemo(
    () => createStreamApplyBuffer(applySegments, { flushIntervalMs: 64 }),
    [applySegments],
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

  const getMessageCountRef = useRef(getMessageCount);
  getMessageCountRef.current = getMessageCount;
  /** 本 run 内已成功 streamCommit 的消息 id，防止 step + RUN_FINISHED 双次提交。 */
  const committedTailIdsRef = useRef<Set<string>>(new Set());

  const clearStreamBuffers = useCallback(() => {
    if (ingressTimerRef.current != null) {
      clearTimeout(ingressTimerRef.current);
      ingressTimerRef.current = null;
    }
    ingressQueueRef.current = [];
    streamClockRef.current.resetStreamClock();
    applyBuffer.reset();
  }, [applyBuffer]);

  const handleStreamEndAfterReload = useCallback(
    ({ messages, prevCount }: FlushStreamEndContext) => {
      clearStreamBuffers();
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
    [clearStreamBuffers],
  );

  const handleStreamReset = useCallback(() => {
    clearStreamBuffers();
    if (useWebviewRef.current) {
      transcriptWebRefRef.current.current?.resetStream();
    } else {
      setStreamingText('');
      setStreamingThinking('');
    }
  }, [clearStreamBuffers]);

  const resetStreamingDisplay = useCallback(() => {
    setStreamingText('');
    setStreamingThinking('');
  }, []);

  const handleIngressText = useCallback(
    (delta: string) => {
      if (delta.length === 0) {
        return;
      }
      streamClockRef.current.noteStreamDelta();
      metricsRef.current.noteMetricsTextDelta(delta);
      ingestWireChunk({ kind: 'text', delta });
    },
    [ingestWireChunk],
  );

  const handleIngressThinking = useCallback(
    (delta: string) => {
      if (delta.length === 0) {
        return;
      }
      streamClockRef.current.noteStreamDelta();
      metricsRef.current.noteMetricsThinkingDelta(delta);
      ingestWireChunk({ kind: 'thinking', delta });
    },
    [ingestWireChunk],
  );

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
        const cb = callbacksRef.current;
        if (payload.phase === 'tool_results') {
          void Promise.resolve(
            cb.onMessagesChanged({ immediate: true }),
          ).catch(() => undefined);
          return;
        }
        flushAgentStepUi(
          payload.phase,
          cb.onMessagesChanged,
          handleStreamEndAfterReload,
          getMessageCountRef.current(),
        )
          .then(() => cb.onStepCommitted?.(payload))
          .catch(() => undefined);
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
        decrementAgentActive();
        const cb = callbacksRef.current;
        flushRunUi(
          cb.onMessagesChanged,
          handleStreamEndAfterReload,
          getMessageCountRef.current(),
        )
          .then(() => lifecycleRef.current.onRunFinished?.(payload))
          .catch(() => undefined);
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
        decrementAgentActive();
        const cb = callbacksRef.current;
        flushRunUi(
          cb.onMessagesChanged,
          handleStreamEndAfterReload,
          getMessageCountRef.current(),
        )
          .then(() => lifecycleRef.current.onRunFailed?.(payload))
          .catch(() => undefined);
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
  ]);

  useEffect(() => {
    return () => {
      applyBuffer.dispose();
      if (ingressTimerRef.current != null) {
        clearTimeout(ingressTimerRef.current);
      }
    };
  }, [applyBuffer]);

  return {
    streamMetricsAccRef,
    streamMetricsLastRun,
    streamingText,
    streamingThinking,
    handleStreamReset,
    resetStreamingDisplay,
  };
}

export type UseChatStreamRuntimeResult = ReturnType<
  typeof useChatStreamRuntime
>;
