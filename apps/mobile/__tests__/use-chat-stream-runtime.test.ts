import React, {useRef} from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {SimpleEventBus} from '@novel-master/core/events';
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
} from '@novel-master/core/events';
import type {ChatTranscriptWebViewHandle} from '@/components/chat/ChatTranscriptWebView';
import {useAgentRunLifecycle} from '@/hooks/useAgentRunLifecycle';
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
      tryCommitStreamTail: jest.fn(() => false),
      ...options?.web,
    };
    const onMessagesChanged = jest.fn(async () => []);
    const onRunFailed = jest.fn();
    let messageCount = 0;
    const api: {
      stream?: ReturnType<typeof useChatStreamRuntime>;
      lifecycle?: ReturnType<typeof useAgentRunLifecycle>;
    } = {};

    function Harness() {
      const ref = useRef<ChatTranscriptWebViewHandle>(webHandle);
      const lifecycle = useAgentRunLifecycle();
      const state = useChatStreamRuntime({
        sessionId: 's1',
        uiRunning: lifecycle.uiRunning,
        useWebviewTranscript: options?.useWebview ?? true,
        chatStreamBatchEnabled: options?.batchEnabled ?? true,
        transcriptWebRef: ref,
        onMessagesChanged,
        getMessageCount: () => messageCount,
        getUiRunning: lifecycle.getUiRunning,
        getTranscriptFreezeCount: lifecycle.getTranscriptFreezeCount,
        acceptRunEvent: lifecycle.acceptRunEvent,
        onRunStarted: lifecycle.onRunStarted,
        onRunFinished: lifecycle.onRunFinished,
        onRunFailed: lifecycle.onRunFailed,
      });
      api.stream = state;
      api.lifecycle = lifecycle;
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
      setMessageCount: (n: number) => {
        messageCount = n;
      },
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

  it('beginUiRun 后 uiRunning 立即为 true', () => {
    const {api} = mountRuntime();
    act(() => {
      api.lifecycle!.beginUiRun();
    });
    expect(api.lifecycle!.uiRunning).toBe(true);
  });

  it('仅 TOOL_USE、无 text/thinking delta 时 uiRunning 仍为 true', () => {
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
    });
    expect(api.lifecycle!.uiRunning).toBe(true);
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

  it('T-AC2-4：abort 后 cancelled RUN_FINISHED 清 lifecycle 但不 flushRunUi', async () => {
    const {api, startRun, setMessageCount} = mountRuntime({beginUiRun: true});
    startRun();
    setMessageCount(2);
    act(() => {
      api.lifecycle!.abortUiRun(2);
    });
    expect(api.lifecycle!.uiRunning).toBe(false);
    expect(api.lifecycle!.getTranscriptFreezeCount()).toBe(2);
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
    expect(api.lifecycle!.getTranscriptFreezeCount()).toBe(null);
    expect(mockFlushRunUi).not.toHaveBeenCalled();
  });

  it('T-AC2-3：abort 后迟到 STEP_COMMITTED(assistant) 不触发 flushAgentStepUi', async () => {
    const {api, startRun, setMessageCount} = mountRuntime({beginUiRun: true});
    startRun();
    setMessageCount(1);
    act(() => {
      api.lifecycle!.abortUiRun(1);
    });
    await act(async () => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STEP_COMMITTED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        phase: 'assistant',
      });
      await Promise.resolve();
    });
    expect(mockFlushAgentStepUi).not.toHaveBeenCalled();
  });

  it('T-AC2-9：abort 后迟到 STEP_COMMITTED(tool_results) 不触发 immediate reload', async () => {
    const {api, startRun, onMessagesChanged, setMessageCount} = mountRuntime({
      beginUiRun: true,
    });
    startRun();
    setMessageCount(1);
    act(() => {
      api.lifecycle!.abortUiRun(1);
    });
    await act(async () => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STEP_COMMITTED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        phase: 'tool_results',
      });
      await Promise.resolve();
    });
    expect(onMessagesChanged).not.toHaveBeenCalled();
  });

  it('T-AC2-8：abort 后迟到 text/thinking delta 不增长 overlay', () => {
    const {api, startRun, setMessageCount} = mountRuntime({
      useWebview: false,
      beginUiRun: true,
    });
    startRun();
    setMessageCount(0);
    act(() => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
        sessionId: 's1',
        runId: RUN_ID,
        text: 'before',
      });
      jest.advanceTimersByTime(96);
    });
    expect(api.stream!.streamingText).toBe('before');

    act(() => {
      api.lifecycle!.abortUiRun(1);
    });

    act(() => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
        sessionId: 's1',
        runId: RUN_ID,
        text: '-late',
      });
      mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
        sessionId: 's1',
        runId: RUN_ID,
        text: 'think-late',
      });
      jest.advanceTimersByTime(96);
    });
    expect(api.stream!.streamingText).toBe('before');
    expect(api.stream!.streamingThinking).toBe('');
  });

  it('T-AC2-10：resetUiForSessionChange 解除 freeze 后 STEP 可正常 reload', async () => {
    const {api, startRun, setMessageCount} = mountRuntime({beginUiRun: true});
    startRun();
    setMessageCount(2);
    act(() => {
      api.lifecycle!.abortUiRun(2);
    });
    expect(api.lifecycle!.getTranscriptFreezeCount()).toBe(2);

    act(() => {
      api.lifecycle!.resetUiForSessionChange();
    });
    expect(api.lifecycle!.getTranscriptFreezeCount()).toBe(null);

    act(() => {
      api.lifecycle!.beginUiRun();
      mockRuntime.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
      });
    });
    setMessageCount(3);
    await act(async () => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STEP_COMMITTED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        phase: 'assistant',
      });
      await Promise.resolve();
    });
    expect(mockFlushAgentStepUi).toHaveBeenCalledTimes(1);
  });

  it('STEP_COMMITTED(assistant) 触发 flushAgentStepUi 并尝试 commit', async () => {
    const tryCommit = jest.fn(() => true);
    const {startRun, setMessageCount} = mountRuntime({
      beginUiRun: true,
      web: { tryCommitStreamTail: tryCommit },
    });
    startRun();
    setMessageCount(1);
    await act(async () => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STEP_COMMITTED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        phase: 'assistant',
      });
      await Promise.resolve();
    });
    expect(mockFlushAgentStepUi).toHaveBeenCalledTimes(1);
  });

  it('STEP_COMMITTED(tool_results) 仅 immediate reload，不 flushAgentStepUi', async () => {
    const {startRun, onMessagesChanged} = mountRuntime({beginUiRun: true});
    startRun();
    await act(async () => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STEP_COMMITTED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        phase: 'tool_results',
      });
      await Promise.resolve();
    });
    expect(mockFlushAgentStepUi).not.toHaveBeenCalled();
    expect(onMessagesChanged).toHaveBeenCalledWith({ immediate: true });
  });

  it('RUN_FINISHED 在 tryCommit 已成功时不再 resetStream', async () => {
    const assistantMsg = { id: 'assistant-1', role: 'assistant' as const };
    const tryCommit = jest.fn(() => true);
    const {startRun, webHandle, setMessageCount, onMessagesChanged} = mountRuntime({
      beginUiRun: true,
      web: { tryCommitStreamTail: tryCommit },
    });
    onMessagesChanged.mockResolvedValue([assistantMsg]);
    startRun();
    setMessageCount(0);
    mockFlushRunUi.mockImplementation(async (reload, onEnd, prevCount) => {
      const messages = (await reload({ immediate: true })) ?? [];
      onEnd({ messages, prevCount });
    });
    mockFlushAgentStepUi.mockImplementation(
      async (phase, reload, onEnd, prevCount) => {
        const messages = (await reload({ immediate: true })) ?? [];
        if (phase === 'assistant') {
          onEnd({ messages, prevCount });
        }
      },
    );
    await act(async () => {
      mockRuntime.eventBus.publish(EVENT_AGENT_STEP_COMMITTED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        phase: 'assistant',
      });
      await Promise.resolve();
    });
    setMessageCount(1);
    await act(async () => {
      mockRuntime.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        stopReason: 'end_turn',
      });
      await Promise.resolve();
    });
    expect(tryCommit).toHaveBeenCalledTimes(1);
    expect(webHandle.resetStream).not.toHaveBeenCalled();
  });
});
