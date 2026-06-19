import React, {useRef} from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {SimpleEventBus} from '@novel-master/core/events';
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
} from '@novel-master/core/events';
import type {ChatTranscriptWebViewHandle} from '@/components/chat/ChatTranscriptWebView';
import {useChatStreamRuntime} from '@/screens/tabs/chat-tab/useChatStreamRuntime';

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

describe('useChatStreamRuntime', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFlushRunUi.mockClear();
    mockFlushAgentStepUi.mockClear();
    mockRuntime.eventBus.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function mountRuntime(options?: {
    useWebview?: boolean;
    batchEnabled?: boolean;
    web?: Partial<ChatTranscriptWebViewHandle>;
  }) {
    const webHandle: ChatTranscriptWebViewHandle = {
      pushStreamDelta: jest.fn(),
      pushStreamBatch: jest.fn(),
      resetStream: jest.fn(),
      ...options?.web,
    };
    const onMessagesChanged = jest.fn(async () => undefined);
    const onRunFailed = jest.fn();
    const api: Partial<ReturnType<typeof useChatStreamRuntime>> = {};

    function Harness() {
      const ref = useRef<ChatTranscriptWebViewHandle>(webHandle);
      const state = useChatStreamRuntime({
        sessionId: 's1',
        useWebviewTranscript: options?.useWebview ?? true,
        chatStreamBatchEnabled: options?.batchEnabled ?? true,
        transcriptWebRef: ref,
        onMessagesChanged,
        onRunFailed,
      });
      Object.assign(api, state);
      return null;
    }

    act(() => {
      TestRenderer.create(React.createElement(Harness));
    });

    return {api: api as ReturnType<typeof useChatStreamRuntime>, webHandle, onMessagesChanged, onRunFailed};
  }

  it('webview：FIFO 交错 wire 走 pushStreamBatch', () => {
    const {webHandle} = mountRuntime();
    act(() => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
        sessionId: 's1',
        text: 'A',
      });
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
        sessionId: 's1',
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
    const {api} = mountRuntime({useWebview: false});
    act(() => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
        sessionId: 's1',
        text: 'think',
      });
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
        sessionId: 's1',
        text: 'body',
      });
      jest.advanceTimersByTime(32);
      jest.advanceTimersByTime(64);
    });
    expect(api.streamingThinking).toBe('think');
    expect(api.streamingText).toBe('body');
  });

  it('RUN_FAILED 触发 flushRunUi', () => {
    mountRuntime();
    act(() => {
      mockRuntime.eventBus.publish(EVENT_AGENT_RUN_FAILED, {
        sessionId: 's1',
        projectId: 'p1',
        error: 'boom',
      });
    });
    expect(mockFlushRunUi).toHaveBeenCalledTimes(1);
  });

  it('TOOL_USE latch 使 toolInvoking 为 true', () => {
    const {api} = mountRuntime();
    act(() => {
      api.setAgentRunning(true);
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_TOOL_USE, {
        sessionId: 's1',
        id: 't1',
        name: 'read',
        input: {},
      });
    });
    expect(api.toolInvoking).toBe(true);
  });

  it('chatStreamBatchEnabled=false 时走 pushStreamDelta 保序', () => {
    const {webHandle} = mountRuntime({batchEnabled: false});
    act(() => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
        sessionId: 's1',
        text: 'A',
      });
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
        sessionId: 's1',
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
});
