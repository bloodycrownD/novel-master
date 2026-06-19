/**
 * Chat tab 流式 runtime：独占 Bus 订阅，FIFO wire → 64ms apply → 双引擎。
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {RefObject} from 'react';
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  type AgentRunFinishedPayload,
  type AgentStepCommittedPayload,
  type AgentStreamTextDeltaPayload,
  type AgentStreamThinkingDeltaPayload,
  type AgentStreamToolUsePayload,
} from '@novel-master/core/events';
import type {ChatTranscriptWebViewHandle} from '@/components/chat/ChatTranscriptWebView';
import {flushAgentStepUi, flushRunUi} from '@/components/chat/flush-run-ui';
import {useStreamMetricsAcc} from '@/hooks/useAgentStreamMetrics';
import {useStreamToolInvokingDisplay} from '@/hooks/useStreamToolInvokingDisplay';
import {useRuntime} from '@/hooks/useRuntime';
import {createStreamApplyBuffer} from '@/services/stream-apply-buffer';
import {
  appendWireChunk,
  coalesceWireQueue,
  type StreamWireChunk,
} from '@/services/stream-wire-queue';

const INGRESS_COALESCE_MS = 32;

/** Bus `agent.run.failed` 载荷（core public 尚未导出类型）。 */
type AgentRunFailedPayload = {
  readonly sessionId: string;
  readonly projectId: string;
  readonly error: string;
};

export type UseChatStreamRuntimeParams = {
  sessionId: string | undefined;
  useWebviewTranscript: boolean;
  chatStreamBatchEnabled: boolean;
  transcriptWebRef: RefObject<ChatTranscriptWebViewHandle | null>;
  onMessagesChanged: () => void | Promise<void>;
  onStepCommitted?: (payload: AgentStepCommittedPayload) => void;
  onRunFinished?: (payload: AgentRunFinishedPayload) => void;
  onRunFailed?: (payload: AgentRunFailedPayload) => void;
};

export function useChatStreamRuntime({
  sessionId,
  useWebviewTranscript,
  chatStreamBatchEnabled,
  transcriptWebRef,
  onMessagesChanged,
  onStepCommitted,
  onRunFinished,
  onRunFailed,
}: UseChatStreamRuntimeParams) {
  const runtime = useRuntime();
  const [agentRunning, setAgentRunning] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const hasSeenStreamTextRef = useRef(false);

  const toolDisplay = useStreamToolInvokingDisplay(agentRunning);
  const {
    accRef: streamMetricsAccRef,
    lastRun: streamMetricsLastRun,
    noteTextDelta: noteMetricsTextDelta,
    noteThinkingDelta: noteMetricsThinkingDelta,
  } = useStreamMetricsAcc(agentRunning);

  const useWebviewRef = useRef(useWebviewTranscript);
  useWebviewRef.current = useWebviewTranscript;
  const batchEnabledRef = useRef(chatStreamBatchEnabled);
  batchEnabledRef.current = chatStreamBatchEnabled;
  const transcriptWebRefRef = useRef(transcriptWebRef);
  transcriptWebRefRef.current = transcriptWebRef;

  const callbacksRef = useRef({
    onMessagesChanged,
    onStepCommitted,
    onRunFinished,
    onRunFailed,
  });
  callbacksRef.current = {
    onMessagesChanged,
    onStepCommitted,
    onRunFinished,
    onRunFailed,
  };

  const toolRef = useRef(toolDisplay);
  toolRef.current = toolDisplay;
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
        web.pushStreamBatch({segments});
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
    () =>
      createStreamApplyBuffer(applySegments, {flushIntervalMs: 64}),
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

  const handleStreamReset = useCallback(() => {
    if (ingressTimerRef.current != null) {
      clearTimeout(ingressTimerRef.current);
      ingressTimerRef.current = null;
    }
    ingressQueueRef.current = [];
    hasSeenStreamTextRef.current = false;
    toolRef.current.resetAll();
    applyBuffer.reset();
    if (useWebviewRef.current) {
      transcriptWebRefRef.current.current?.resetStream();
    } else {
      setStreamingText('');
      setStreamingThinking('');
    }
  }, [applyBuffer]);

  const resetStreamingDisplay = useCallback(() => {
    setStreamingText('');
    setStreamingThinking('');
  }, []);

  const handleIngressText = useCallback(
    (delta: string) => {
      if (delta.length === 0) {
        return;
      }
      if (!hasSeenStreamTextRef.current) {
        hasSeenStreamTextRef.current = true;
        toolRef.current.clearToolUseLatch();
      }
      toolRef.current.noteTextDelta(delta);
      metricsRef.current.noteMetricsTextDelta(delta);
      ingestWireChunk({kind: 'text', delta});
    },
    [ingestWireChunk],
  );

  const handleIngressThinking = useCallback(
    (delta: string) => {
      if (delta.length === 0) {
        return;
      }
      toolRef.current.noteThinkingDelta(delta);
      metricsRef.current.noteMetricsThinkingDelta(delta);
      ingestWireChunk({kind: 'thinking', delta});
    },
    [ingestWireChunk],
  );

  useEffect(() => {
    if (sessionId == null) {
      return undefined;
    }
    const sid = sessionId;
    const bus = runtime.eventBus;

    const subText = bus.subscribe(
      EVENT_AGENT_STREAM_TEXT_DELTA,
      (payload: AgentStreamTextDeltaPayload) => {
        if (payload.sessionId === sid) {
          handleIngressText(payload.text);
        }
      },
    );
    const subThinking = bus.subscribe(
      EVENT_AGENT_STREAM_THINKING_DELTA,
      (payload: AgentStreamThinkingDeltaPayload) => {
        if (payload.sessionId === sid) {
          handleIngressThinking(payload.text);
        }
      },
    );
    const subToolUse = bus.subscribe(
      EVENT_AGENT_STREAM_TOOL_USE,
      (payload: AgentStreamToolUsePayload) => {
        if (payload.sessionId === sid) {
          toolRef.current.latchToolUse();
        }
      },
    );
    const subStep = bus.subscribe(
      EVENT_AGENT_STEP_COMMITTED,
      (payload: AgentStepCommittedPayload) => {
        if (payload.sessionId !== sid) {
          return;
        }
        const cb = callbacksRef.current;
        if (payload.phase === 'tool_results') {
          void Promise.resolve(cb.onMessagesChanged()).catch(() => undefined);
          return;
        }
        flushAgentStepUi(payload.phase, cb.onMessagesChanged, handleStreamReset)
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
        const cb = callbacksRef.current;
        flushRunUi(cb.onMessagesChanged, handleStreamReset)
          .then(() => cb.onRunFinished?.(payload))
          .catch(() => undefined);
      },
    );
    const subFailed = bus.subscribe(
      EVENT_AGENT_RUN_FAILED,
      (payload: AgentRunFailedPayload) => {
        if (payload.sessionId !== sid) {
          return;
        }
        const cb = callbacksRef.current;
        flushRunUi(cb.onMessagesChanged, handleStreamReset)
          .then(() => cb.onRunFailed?.(payload))
          .catch(() => undefined);
      },
    );

    return () => {
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
    handleStreamReset,
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
    agentRunning,
    setAgentRunning,
    toolInvoking: toolDisplay.toolInvoking,
    streamMetricsAccRef,
    streamMetricsLastRun,
    streamingText,
    streamingThinking,
    handleStreamReset,
    resetStreamingDisplay,
  };
}

export type UseChatStreamRuntimeResult = ReturnType<typeof useChatStreamRuntime>;
