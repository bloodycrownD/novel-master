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
import {useSessionAbort} from '@/screens/tabs/chat-tab/useSessionAbort';
import {useSessionBatch} from '@/screens/tabs/chat-tab/useSessionBatch';
import {useSessionStream} from '@/screens/tabs/chat-tab/useSessionStream';
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

/**
 * T-M1 回归：拆单元后主会话 stream/abort/batch 行为应与拆分前一致。
 * 本 file 走与 ChatTabProvider 等价的装配顺序（abort → batch → lifecycle → stream），
 * 用 compat api.lifecycle 暴露统一接口，保留拆分前的 test case body。
 */
describe('useSessionStream + useSessionAbort + useSessionBatch (主会话 T-M1 回归)', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
    mockFlushRunUi.mockClear();
    mockFlushAgentStepUi.mockClear();
    mockRuntime.eventBus.clear();
    setMobileAgentActive(false);
  });

  afterEach(() => {
    if (renderer != null) {
      act(() => {
        renderer!.unmount();
      });
      renderer = null;
    }
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
      commitAbortOverlaySnapshot: jest.fn(() => false),
      ...options?.web,
    };
    const onMessagesChanged = jest.fn(async () => []);
    const onRunFailed = jest.fn();
    let messageCount = 0;
    const api: {
      stream?: ReturnType<typeof useSessionStream>;
      lifecycle?: ReturnType<typeof useAgentRunLifecycle>;
      abort?: ReturnType<typeof useSessionAbort>;
      /**
       * 兼容拆分前的 lifecycle 形态：把 abort 单元的 uiRunning/abortUiRun/
       * freeze/retain 与 lifecycle 单元的 activeRunId/beginUiRun 聚合到一起，
       * 让原 test case body 不用大改。
       */
      compat?: {
        uiRunning: boolean;
        activeRunId: string | null;
        beginUiRun(): void;
        abortUiRun(freezeAt?: number): void;
        resetUiForSessionChange(): void;
        getTranscriptFreezeCount(): number | null;
        getAbortRetainPending(): boolean;
        acceptRunEvent(runId: string | undefined): boolean;
      };
    } = {};

    // 简易 abort registry mock：记录 abort 调用即可。
    const abortRegistry = {
      register: jest.fn(),
      abort: jest.fn(),
      unregister: jest.fn(),
      has: jest.fn(() => false),
    };

    function Harness() {
      const ref = useRef<ChatTranscriptWebViewHandle>(webHandle);
      const onStreamResetRef = useRef<() => void>(() => undefined);
      const applySegmentsRef = useRef<
        (segments: readonly {kind: 'text' | 'thinking'; delta: string}[]) => void
      >(() => undefined);

      const abort = useSessionAbort({
        sessionId: 's1',
        abortRegistry: abortRegistry as never,
        onStreamResetRef,
      });
      const lifecycle = useAgentRunLifecycle({
        onRunUiActivate: abort.markRunStarted,
        onRunUiDeactivate: abort.markRunEnded,
        getUiRunning: abort.getUiRunning,
      });
      const batch = useSessionBatch({
        applySegments: segments => applySegmentsRef.current(segments),
      });
      const stream = useSessionStream({
        sessionId: 's1',
        useWebviewTranscript: options?.useWebview ?? true,
        batchEnabled: options?.batchEnabled ?? true,
        transcriptWebRef: ref,
        uiRunning: abort.uiRunning,
        acceptRunEvent: lifecycle.acceptRunEvent,
        onRunStarted: lifecycle.onRunStarted,
        onRunFinished: lifecycle.onRunFinished,
        onRunFailed: lifecycle.onRunFailed,
        getUiRunning: abort.getUiRunning,
        getTranscriptFreezeCount: abort.getTranscriptFreezeCount,
        getAbortRetainPending: abort.getAbortRetainPending,
        clearAbortRetainPending: abort.clearAbortRetainPending,
        batchIngest: batch.ingestWireChunk,
        batchClear: batch.clearBuffers,
        onMessagesChanged,
        getMessageCount: () => messageCount,
      });
      applySegmentsRef.current = stream.applySegments;
      onStreamResetRef.current = stream.handleStreamReset;

      api.stream = stream;
      api.lifecycle = lifecycle;
      api.abort = abort;
      api.compat = {
        uiRunning: abort.uiRunning,
        activeRunId: lifecycle.activeRunId,
        beginUiRun: lifecycle.beginUiRun,
        abortUiRun: abort.abortUiRun,
        resetUiForSessionChange: () => {
          abort.resetForSessionChange();
          lifecycle.resetUiForSessionChange();
        },
        getTranscriptFreezeCount: abort.getTranscriptFreezeCount,
        getAbortRetainPending: abort.getAbortRetainPending,
        acceptRunEvent: lifecycle.acceptRunEvent,
      };
      return null;
    }

    act(() => {
      renderer = TestRenderer.create(React.createElement(Harness));
    });

    if (options?.beginUiRun) {
      act(() => {
        api.compat!.beginUiRun();
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

  it('RUN_FAILED 触发 flushRunUi 并递减 agentActive', async () => {
    const {startRun} = mountRuntime({beginUiRun: true});
    startRun();
    await act(async () => {
      mockRuntime.eventBus.publish(EVENT_AGENT_RUN_FAILED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        error: 'boom',
      });
      // flushRunUi().then(failRun) 走两步 microtask。
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
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
      api.compat!.beginUiRun();
    });
    expect(api.compat!.uiRunning).toBe(true);
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
    expect(api.compat!.uiRunning).toBe(true);
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
    expect(api.compat!.uiRunning).toBe(false);
    expect(mockFlushRunUi).toHaveBeenCalledTimes(1);
  });

  it('T-ARP-M4 / T-AC2-4：abort 后 cancelled RUN_FINISHED 清 lifecycle 但不 flushRunUi', async () => {
    const {api, startRun, setMessageCount, webHandle} = mountRuntime({beginUiRun: true});
    startRun();
    setMessageCount(2);
    act(() => {
      api.compat!.abortUiRun(2);
    });
    expect(api.compat!.uiRunning).toBe(false);
    expect(api.compat!.getTranscriptFreezeCount()).toBe(2);
    expect(api.compat!.getAbortRetainPending()).toBe(true);
    expect(api.compat!.activeRunId).toBe(RUN_ID);
    await act(async () => {
      mockRuntime.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        stopReason: 'cancelled',
      });
      await Promise.resolve();
    });
    expect(api.compat!.activeRunId).toBe(null);
    expect(api.compat!.uiRunning).toBe(false);
    expect(api.compat!.getTranscriptFreezeCount()).toBe(null);
    expect(api.compat!.getAbortRetainPending()).toBe(false);
    expect(mockFlushRunUi).not.toHaveBeenCalled();
    expect(webHandle.commitAbortOverlaySnapshot).toHaveBeenCalled();
  });

  it('T-ARP-M1 / T-AC2-3：abort 后 STEP_COMMITTED(assistant) 允许一次 flushAgentStepUi + resetStream', async () => {
    const {api, startRun, setMessageCount, webHandle} = mountRuntime({beginUiRun: true});
    startRun();
    setMessageCount(1);
    act(() => {
      api.compat!.abortUiRun(1);
    });
    expect(api.compat!.getAbortRetainPending()).toBe(true);
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
    expect(api.compat!.getAbortRetainPending()).toBe(false);
    expect(webHandle.resetStream).toHaveBeenCalledTimes(1);
  });

  it('T-AC2-R2：retain 完成后迟到 STEP_COMMITTED(assistant) 不二次 flush', async () => {
    const {api, startRun, setMessageCount} = mountRuntime({beginUiRun: true});
    startRun();
    setMessageCount(1);
    act(() => {
      api.compat!.abortUiRun(1);
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
    mockFlushAgentStepUi.mockClear();
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
      api.compat!.abortUiRun(1);
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

  it('T-ARP-M2：retain 完成后 late STEP_COMMITTED(tool_results) 不 reload', async () => {
    const {api, startRun, onMessagesChanged, setMessageCount} = mountRuntime({
      beginUiRun: true,
    });
    startRun();
    setMessageCount(1);
    act(() => {
      api.compat!.abortUiRun(1);
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
    expect(api.compat!.getAbortRetainPending()).toBe(false);
    onMessagesChanged.mockClear();
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
      api.compat!.abortUiRun(1);
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
      api.compat!.abortUiRun(2);
    });
    expect(api.compat!.getTranscriptFreezeCount()).toBe(2);

    act(() => {
      api.compat!.resetUiForSessionChange();
    });
    expect(api.compat!.getTranscriptFreezeCount()).toBe(null);

    act(() => {
      api.compat!.beginUiRun();
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
