import React, {useRef} from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {SimpleEventBus} from '@novel-master/core/events';
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
} from '@novel-master/core/events';
import type {ChatTranscriptWebViewHandle} from '@/components/chat/ChatTranscriptWebView';
import {useAgentRunLifecycle} from '@/hooks/useAgentRunLifecycle';
import {useStreamTailGenerating} from '@/hooks/useStreamTailGenerating';
import {useChatStreamRuntime} from '@/screens/tabs/chat-tab/useChatStreamRuntime';
import {
  isMobileAgentActive,
  setMobileAgentActive,
} from '@/runtime/agent-activity';

const mockFlushRunUi = jest.fn(async () => undefined);
const mockFlushAgentStepUi = jest.fn(async () => undefined);

jest.mock('@/components/chat/flush-run-ui', () => ({
  flushRunUi: (...args: unknown[]) => mockFlushRunUi(...args),
  flushAgentStepUi: (...args: unknown[]) => mockFlushAgentStepUi(...args),
}));

const mockRuntime = {eventBus: new SimpleEventBus()};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

const RUN_ID = 'run-test-1';

describe('useChatStreamRuntime', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFlushRunUi.mockClear();
    mockFlushAgentStepUi.mockClear();
    mockRuntime.eventBus.clear();
    setMobileAgentActive(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    setMobileAgentActive(false);
  });

  function mountRuntime(options?: {
    useWebview?: boolean;
    batchEnabled?: boolean;
    web?: Partial<ChatTranscriptWebViewHandle>;
    beginUiRun?: boolean;
  }) {
    const webHandle: ChatTranscriptWebViewHandle = {
      pushStreamDelta: jest.fn(),
      pushStreamBatch: jest.fn(),
      resetStream: jest.fn(),
      ...options?.web,
    };
    const onMessagesChanged = jest.fn(async () => undefined);
    const onRunFailed = jest.fn();
    const api: {
      stream?: ReturnType<typeof useChatStreamRuntime>;
      lifecycle?: ReturnType<typeof useAgentRunLifecycle>;
      streamTail?: ReturnType<typeof useStreamTailGenerating>;
    } = {};

    function Harness() {
      const ref = useRef<ChatTranscriptWebViewHandle>(webHandle);
      const lifecycle = useAgentRunLifecycle();
      const streamTail = useStreamTailGenerating(lifecycle.uiRunning);
      const state = useChatStreamRuntime({
        sessionId: 's1',
        uiRunning: lifecycle.uiRunning,
        useWebviewTranscript: options?.useWebview ?? true,
        chatStreamBatchEnabled: options?.batchEnabled ?? true,
        transcriptWebRef: ref,
        onMessagesChanged,
        acceptRunEvent: lifecycle.acceptRunEvent,
        onRunStarted: lifecycle.onRunStarted,
        onRunFinished: lifecycle.onRunFinished,
        onRunFailed: lifecycle.onRunFailed,
        noteStreamDelta: streamTail.noteStreamDelta,
        resetStreamClock: streamTail.resetStreamClock,
      });
      api.stream = state;
      api.lifecycle = lifecycle;
      api.streamTail = streamTail;
      return null;
    }

    act(() => {
      TestRenderer.create(React.createElement(Harness));
    });

    if (options?.beginUiRun) {
      act(() => {
        api.lifecycle!.beginUiRun();
      });
    }

    const startRun = () => {
      act(() => {
        mockRuntime.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
          sessionId: 's1',
          projectId: 'p1',
          runId: RUN_ID,
        });
      });
    };

    return {
      api: api as Required<typeof api>,
      webHandle,
      onMessagesChanged,
      onRunFailed,
      startRun,
    };
  }

  it('webview：FIFO 交错 wire 走 pushStreamBatch', () => {
    const {webHandle, startRun} = mountRuntime({beginUiRun: true});
    startRun();
    act(() => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
        sessionId: 's1',
        runId: RUN_ID,
        text: 'A',
      });
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
        sessionId: 's1',
        runId: RUN_ID,
        text: 'B',
      });
      jest.advanceTimersByTime(32);
      jest.advanceTimersByTime(64);
    });
    expect(webHandle.pushStreamBatch).toHaveBeenCalled();
    const payload = (webHandle.pushStreamBatch as jest.Mock).mock.calls[0]![0];
    expect(payload.segments).toEqual([
      {kind: 'thinking', delta: 'A'},
      {kind: 'text', delta: 'B'},
    ]);
  });

  it('legacy-rn：更新 streamingText/Thinking', () => {
    const {api, startRun} = mountRuntime({useWebview: false, beginUiRun: true});
    startRun();
    act(() => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
        sessionId: 's1',
        runId: RUN_ID,
        text: 'think',
      });
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
        sessionId: 's1',
        runId: RUN_ID,
        text: 'body',
      });
      jest.advanceTimersByTime(32);
      jest.advanceTimersByTime(64);
    });
    expect(api.stream!.streamingThinking).toBe('think');
    expect(api.stream!.streamingText).toBe('body');
  });

  it('RUN_FAILED 触发 flushRunUi 并递减 agentActive', () => {
    const {startRun} = mountRuntime({beginUiRun: true});
    startRun();
    act(() => {
      mockRuntime.eventBus.publish(EVENT_AGENT_RUN_FAILED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        error: 'boom',
      });
    });
    expect(mockFlushRunUi).toHaveBeenCalledTimes(1);
    expect(isMobileAgentActive()).toBe(false);
  });

  it('stale delta 在 runId 不匹配时被丢弃', () => {
    const {api, startRun} = mountRuntime({useWebview: false, beginUiRun: true});
    startRun();
    act(() => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
        sessionId: 's1',
        runId: 'stale-run',
        text: 'x',
      });
      jest.advanceTimersByTime(96);
    });
    expect(api.stream!.streamingText).toBe('');
  });

  it('thinking 空闲 ≥300ms 后 streamTailGenerating 为 true', () => {
    const {api, startRun} = mountRuntime({beginUiRun: true});
    startRun();
    act(() => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
        sessionId: 's1',
        runId: RUN_ID,
        text: 'think',
      });
    });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(api.streamTail!.streamTailGenerating).toBe(true);
  });

  it('仅 TOOL_USE、无 text/thinking delta 时空闲 ≥300ms 显示 streamTailGenerating', () => {
    const {api, startRun} = mountRuntime({beginUiRun: true});
    startRun();
    act(() => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_TOOL_USE, {
        sessionId: 's1',
        runId: RUN_ID,
        id: 't1',
        name: 'read',
        input: {},
      });
      jest.advanceTimersByTime(500);
    });
    expect(api.streamTail!.streamTailGenerating).toBe(true);
  });

  it('chatStreamBatchEnabled=false 时走 pushStreamDelta 保序', () => {
    const {webHandle, startRun} = mountRuntime({batchEnabled: false, beginUiRun: true});
    startRun();
    act(() => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
        sessionId: 's1',
        runId: RUN_ID,
        text: 'A',
      });
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
        sessionId: 's1',
        runId: RUN_ID,
        text: 'B',
      });
      jest.advanceTimersByTime(32);
      jest.advanceTimersByTime(64);
    });
    expect(webHandle.pushStreamBatch).not.toHaveBeenCalled();
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(2);
    expect((webHandle.pushStreamDelta as jest.Mock).mock.calls[0]).toEqual([
      'thinking',
      'A',
    ]);
    expect((webHandle.pushStreamDelta as jest.Mock).mock.calls[1]).toEqual([
      'text',
      'B',
    ]);
  });

  it('RUN_FINISHED 匹配 runId 时收尾 uiRunning', async () => {
    const {api, startRun} = mountRuntime({beginUiRun: true});
    startRun();
    await act(async () => {
      mockRuntime.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        stopReason: 'end_turn',
      });
      await Promise.resolve();
    });
    expect(api.lifecycle!.uiRunning).toBe(false);
    expect(mockFlushRunUi).toHaveBeenCalledTimes(1);
  });

  it('abort 后保留 activeRunId，cancelled RUN_FINISHED 仍 flushRunUi', async () => {
    const {api, startRun} = mountRuntime({beginUiRun: true});
    startRun();
    act(() => {
      api.lifecycle!.abortUiRun();
    });
    expect(api.lifecycle!.uiRunning).toBe(false);
    expect(api.lifecycle!.activeRunId).toBe(RUN_ID);
    await act(async () => {
      mockRuntime.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        stopReason: 'cancelled',
      });
      await Promise.resolve();
    });
    expect(api.lifecycle!.activeRunId).toBe(null);
    expect(api.lifecycle!.uiRunning).toBe(false);
    expect(mockFlushRunUi).toHaveBeenCalledTimes(1);
  });
});
