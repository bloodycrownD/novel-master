/**
 * 主会话流式内容重进恢复测试（T-R1/T-R3/R4/R5/R6/R7/R8）。
 *
 * 范式：use-chat-stream-runtime.test.ts 的 hook 组装测试——abort/batch/
 * lifecycle/stream/inject/probe 按 ChatTabProvider 等价顺序装配，事件经
 * SimpleEventBus 发布，webview 用 mock handle 断言 imperative 通道调用。
 */
import React, {useRef} from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {AppState} from 'react-native';
import {SimpleEventBus} from '@novel-master/core/events';
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
} from '@novel-master/core/events';
import type {ChatTranscriptWebViewHandle} from '@/components/chat/ChatTranscriptWebView';
import {useAgentRunLifecycle} from '@/hooks/useAgentRunLifecycle';
import {useRunResumeProbe} from '@/hooks/use-run-resume-probe';
import {useChatStreamResumeInject} from '@/screens/tabs/chat-tab/useChatStreamResumeInject';
import {useSessionAbort} from '@/screens/tabs/chat-tab/useSessionAbort';
import {useSessionBatch} from '@/screens/tabs/chat-tab/useSessionBatch';
import {useSessionStream} from '@/screens/tabs/chat-tab/useSessionStream';
import type {ChatSubview} from '@/screens/tabs/chat-tab/useChatTabScope';
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

const RUN_ID = 'run-live-1';

/** 可控 core registry mock：s1 是否仍有 in-flight run / partial 快照。 */
let s1Has = false;
let s1Partial: {text: string; thinking: string} | undefined;
const eventBus = new SimpleEventBus();

const mockRuntime: unknown = {
  eventBus,
  abortRegistry: {
    register: jest.fn(),
    abort: jest.fn(),
    unregister: jest.fn(),
    has: jest.fn((sid: string) => sid === 's1' && s1Has),
  },
  streamRegistry: {
    register: jest.fn(),
    reset: jest.fn(),
    append: jest.fn(),
    get: jest.fn((sid: string) => (sid === 's1' ? s1Partial : undefined)),
    has: jest.fn((sid: string) => sid === 's1' && s1Partial != null),
    unregister: jest.fn(),
  },
};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

describe('主会话流式重进恢复（T-R1/R3/R4/R5/R7/R8）', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  let webHandle: ChatTranscriptWebViewHandle;
  let onMessagesChanged: jest.Mock;
  let onStepCommitted: jest.Mock;
  let messageCount = 0;

  beforeEach(() => {
    jest.useFakeTimers();
    mockFlushRunUi.mockClear();
    mockFlushAgentStepUi.mockClear();
    eventBus.clear();
    setMobileAgentActive(false);
    s1Has = false;
    s1Partial = undefined;
    messageCount = 1;
    onMessagesChanged = jest.fn(async () => []);
    onStepCommitted = jest.fn();
    webHandle = {
      pushStreamDelta: jest.fn(),
      pushStreamBatch: jest.fn(),
      resetStream: jest.fn(),
      tryCommitStreamTail: jest.fn(() => false),
      commitAbortOverlaySnapshot: jest.fn(() => false),
    };
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

  /** 与 ChatTabProvider 等价的完整装配（含注入 hook 与双方向探针）。 */
  function mountFull(initialSessionId: string) {
    const api: {
      abort?: ReturnType<typeof useSessionAbort>;
      lifecycle?: ReturnType<typeof useAgentRunLifecycle>;
      stream?: ReturnType<typeof useSessionStream>;
      inject?: ReturnType<typeof useChatStreamResumeInject>;
      compat?: {
        uiRunning: boolean;
        activeRunId: string | null;
        beginUiRun(): void;
      };
    } = {};

    function Harness(props: {sessionId: string; chatSubview: ChatSubview}) {
      const {sessionId, chatSubview} = props;
      const ref = useRef<ChatTranscriptWebViewHandle>(webHandle);
      const onStreamResetRef = useRef<() => void>(() => undefined);
      const applySegmentsRef = useRef<
        (segments: readonly {kind: 'text' | 'thinking'; delta: string}[]) => void
      >(() => undefined);
      const abort = useSessionAbort({
        sessionId,
        abortRegistry: mockRuntime.abortRegistry as never,
        onStreamResetRef,
      });
      const lifecycle = useAgentRunLifecycle({
        onRunUiActivate: abort.markRunStarted,
        onRunUiDeactivate: abort.markRunEnded,
        getUiRunning: abort.getUiRunning,
        getResumeWindowEligible: () =>
          sessionId != null && mockRuntime.abortRegistry.has(sessionId),
      });
      const sessionKey = sessionId != null ? `p1:${sessionId}` : '';
      const inject = useChatStreamResumeInject({
        chatSubview,
        sessionKey,
        sessionId,
        uiRunning: abort.uiRunning,
        transcriptWebRef: ref,
        // messages 已加载（非 0）——注入守卫允许（先 snapshot 后 inject）
        messagesLength: 3,
        streamRegistry: mockRuntime.streamRegistry as never,
      });
      // 与 ChatTabProvider 同款 reset effect：session 切换时清状态（lifecycle
      // 内部同步查 registry 开恢复窗口）；声明在探针之前，同 commit 内
      // reset 先清、探针再按 registry.has 合成 markRunStarted。
      React.useEffect(() => {
        abort.resetForSessionChange();
        lifecycle.resetUiForSessionChange();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 session 切换时重置 UI（与 Provider 同款）
      }, [sessionId]);
      useRunResumeProbe({
        sessionId,
        isRunRegistered: () =>
          sessionId != null && mockRuntime.abortRegistry.has(sessionId),
        onRunActive: () => {
          abort.markRunStarted();
        },
        onRunEnded: () => {
          abort.markRunEnded();
        },
        uiRunning: abort.uiRunning,
        isRunActive: abort.getUiRunning,
      });
      const batch = useSessionBatch({
        applySegments: segments => applySegmentsRef.current(segments),
      });
      const stream = useSessionStream({
        sessionId,
        useWebviewTranscript: true,
        batchEnabled: true,
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
        batchFlush: batch.flushBuffers,
        onMessagesChanged,
        getMessageCount: () => messageCount,
        onStepCommitted: payload => {
          inject.resetInjection();
          onStepCommitted(payload);
        },
      });
      applySegmentsRef.current = stream.applySegments;
      onStreamResetRef.current = stream.handleStreamReset;
      api.abort = abort;
      api.lifecycle = lifecycle;
      api.stream = stream;
      api.inject = inject;
      api.compat = {
        uiRunning: abort.uiRunning,
        activeRunId: lifecycle.activeRunId,
        beginUiRun: lifecycle.beginUiRun,
      };
      return null;
    }

    act(() => {
      renderer = TestRenderer.create(
        React.createElement(Harness, {
          sessionId: initialSessionId,
          chatSubview: 'conversation',
        }),
      );
    });
    return {
      api: api as Required<typeof api>,
      rerender(props: {sessionId?: string; chatSubview?: ChatSubview}) {
        const prev = renderer!.root.findByType(Harness).props as {
          sessionId: string;
          chatSubview: ChatSubview;
        };
        act(() => {
          renderer!.update(
            React.createElement(Harness, {
              sessionId: props.sessionId ?? prev.sessionId,
              chatSubview: props.chatSubview ?? prev.chatSubview,
            }),
          );
        });
      },
      publish(event: string, payload: unknown) {
        act(() => {
          eventBus.publish(event, payload);
        });
      },
      flushBatch() {
        act(() => {
          jest.advanceTimersByTime(32);
          jest.advanceTimersByTime(64);
        });
      },
    };
  }

  it('T-R1 路径 B：切回会话后 delta/step/finish 事件被接纳并上屏、收尾正常', async () => {
    // s1 生成中（registry 仍注册），用户切到 s2 再切回
    s1Has = true;
    s1Partial = {text: '', thinking: ''};
    const h = mountFull('s2');
    // s2 上发起的旧事件先正常跑起来（在 s1 上的 run 与之无关，这里只构造状态）
    act(() => {
      h.api.compat.beginUiRun();
    });
    h.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's2',
      projectId: 'p1',
      runId: 'run-s2-x',
    });
    // 切回 s1：reset 开窗 + 探针合成 markRunStarted（uiRunning 恢复）
    h.rerender({sessionId: 's1'});
    expect(h.api.abort.uiRunning).toBe(true);

    // 后续 delta 被接纳（恢复窗口内放宽，反填真实 runId）
    h.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
      sessionId: 's1',
      projectId: 'p1',
      runId: RUN_ID,
      text: '重进后的增量',
    });
    h.flushBatch();
    expect(webHandle.pushStreamBatch).toHaveBeenCalled();
    const payload = (webHandle.pushStreamBatch as jest.Mock).mock
      .calls[0]![0];
    expect(payload.segments).toEqual([{kind: 'text', delta: '重进后的增量'}]);

    // step 提交被接纳：onStepCommitted（重置注入标记）触发
    s1Partial = {text: 'step2 partial', thinking: ''};
    await act(async () => {
      h.publish(EVENT_AGENT_STEP_COMMITTED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        phase: 'assistant',
      });
      await Promise.resolve();
    });
    expect(onStepCommitted).toHaveBeenCalledTimes(1);

    // finish 被接纳并收尾：uiRunning 归 false、refcount 平衡（beginUiRun 一次）
    await act(async () => {
      h.publish(EVENT_AGENT_RUN_FINISHED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: RUN_ID,
        stopReason: 'end_turn',
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.api.abort.uiRunning).toBe(false);
    expect(isMobileAgentActive()).toBe(false);
  });

  it('T-R7 防回归：无进行中 run 的会话切换，事件仍被拒；正常完成流程行为不变', async () => {
    const h = mountFull('s1');
    // 无 in-flight run（has=false）：切走再切回不开窗，迟到事件被拒
    h.rerender({sessionId: 's2'});
    h.rerender({sessionId: 's1'});
    expect(h.api.abort.uiRunning).toBe(false);
    h.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-orphan',
      text: '不应上屏',
    });
    h.flushBatch();
    expect(webHandle.pushStreamBatch).not.toHaveBeenCalled();

    // 正常完成流程与现状一致：beginUiRun → RUN_STARTED → delta → FINISHED
    act(() => {
      h.api.compat.beginUiRun();
    });
    h.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-normal',
    });
    expect(h.api.compat.uiRunning).toBe(true);
    h.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-normal',
      text: '正文',
    });
    h.flushBatch();
    expect(webHandle.pushStreamBatch).toHaveBeenCalled();
    await act(async () => {
      h.publish(EVENT_AGENT_RUN_FINISHED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: 'run-normal',
        stopReason: 'end_turn',
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.api.compat.uiRunning).toBe(false);
    expect(isMobileAgentActive()).toBe(false);
  });

  /** 注入 hook 单元组装：props 可控 rerender，直接断言 imperative 注入。 */
  function mountInject(initial: {
    chatSubview: ChatSubview;
    sessionKey: string;
    sessionId: string | undefined;
    messagesLength: number;
    partial: {text: string; thinking: string} | undefined;
  }) {
    const handles: {
      inject?: ReturnType<typeof useChatStreamResumeInject>;
    } = {};
    const streamRegistry = {
      // 简化 mock：只返回当前设置的 partial（测试内同时只有一个活跃会话）
      get: jest.fn(() => curPartial),
    };
    let curPartial = initial.partial;

    function Harness(props: {
      chatSubview: ChatSubview;
      sessionKey: string;
      sessionId: string | undefined;
      messagesLength: number;
    }) {
      const ref = useRef<ChatTranscriptWebViewHandle>(webHandle);
      handles.inject = useChatStreamResumeInject({
        chatSubview: props.chatSubview,
        sessionKey: props.sessionKey,
        sessionId: props.sessionId,
        uiRunning: true,
        transcriptWebRef: ref,
        messagesLength: props.messagesLength,
        streamRegistry,
      });
      return null;
    }

    act(() => {
      renderer = TestRenderer.create(React.createElement(Harness, initial));
    });
    return {
      handles,
      markReady() {
        act(() => {
          handles.inject!.markWebviewReady();
        });
      },
      resetInjection() {
        act(() => {
          handles.inject!.resetInjection();
        });
      },
      rerender(props: Partial<typeof initial>) {
        const prev = renderer!.root.findByType(Harness).props as typeof initial;
        act(() => {
          renderer!.update(React.createElement(Harness, {...prev, ...props}));
        });
      },
      setPartial(p: {text: string; thinking: string} | undefined) {
        curPartial = p;
      },
    };
  }

  it('T-R3 注入：messages 加载完成后注入 text/thinking 各一次（先 snapshot 后 inject）', () => {
    const h = mountInject({
      chatSubview: 'conversation',
      sessionKey: 'p1:s1',
      sessionId: 's1',
      messagesLength: 0,
      partial: {text: '正文 partial', thinking: '思考 partial'},
    });
    // messages 未加载（length=0）不注入——注入必须晚于 sessionSnapshot
    h.markReady();
    expect(webHandle.pushStreamDelta).not.toHaveBeenCalled();
    // messages 加载完成后注入 text/thinking 各一次
    h.rerender({messagesLength: 3});
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(2);
    expect(webHandle.pushStreamDelta).toHaveBeenNthCalledWith(
      1,
      'text',
      '正文 partial',
    );
    expect(webHandle.pushStreamDelta).toHaveBeenNthCalledWith(
      2,
      'thinking',
      '思考 partial',
    );
  });

  it('T-R4 per-step：step 提交重置注入标记，下一 step 的 partial 可再注入且不含上一 step 内容', () => {
    const h = mountInject({
      chatSubview: 'conversation',
      sessionKey: 'p1:s1',
      sessionId: 's1',
      messagesLength: 3,
      partial: {text: 'step1-body', thinking: ''},
    });
    h.markReady();
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(1);
    expect(webHandle.pushStreamDelta).toHaveBeenCalledWith('text', 'step1-body');

    // step 提交（resetInjection）+ registry 已 reset 为下一 step 的累积 + 落库 +1
    h.setPartial({text: 'step2-body', thinking: ''});
    h.resetInjection();
    h.rerender({messagesLength: 4});
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(2);
    expect(webHandle.pushStreamDelta).toHaveBeenLastCalledWith(
      'text',
      'step2-body',
    );
    // 第二次注入只含下一 step 的累积（registry.reset 后 get 不含已落库内容）
    const calls = (webHandle.pushStreamDelta as jest.Mock).mock.calls;
    expect(calls[calls.length - 1]).toEqual(['text', 'step2-body']);
    expect(calls.filter(c => c[1] === 'step1-body')).toHaveLength(1);
  });

  it('T-R5 路径 A：同一会话反复重进 ≥2 次，每次重挂后都重新注入且 ready 前不注入', () => {
    const h = mountInject({
      chatSubview: 'conversation',
      sessionKey: 'p1:s1',
      sessionId: 's1',
      messagesLength: 3,
      partial: {text: 'abc', thinking: 'th'},
    });
    // 第一次进入：ready 后注入
    h.markReady();
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(2);

    // 第二次进入：切走（面板卸载）→ 标记复位；切回后未 ready 前不注入（ready 不残留抢先）
    h.rerender({chatSubview: 'sessions'});
    h.rerender({chatSubview: 'conversation'});
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(2);
    h.markReady();
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(4);

    // 第三次进入：仍重新注入（streamInjectedRef 不残留）
    h.rerender({chatSubview: 'sessions'});
    h.rerender({chatSubview: 'conversation'});
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(4);
    h.markReady();
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(6);
  });

  it('T-R5b 路径 B 复位：sessionKey 变化后 ready 不残留，新会话需重新 ready 才注入', () => {
    const h = mountInject({
      chatSubview: 'conversation',
      sessionKey: 'p1:s1',
      sessionId: 's1',
      messagesLength: 3,
      partial: {text: 'abc', thinking: ''},
    });
    h.markReady();
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(1);
    // 会话切换（sessionKey 变化，chatSubview 保持 conversation）：ready 复位，未重新 ready 前不注入
    h.rerender({sessionKey: 'p1:s2', sessionId: 's2'});
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(1);
    // 新 WebView ready 前先更新新会话的 partial；ready 后按新会话 partial 注入
    h.setPartial({text: 's2-body', thinking: ''});
    h.markReady();
    h.rerender({messagesLength: 5});
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(2);
    expect(webHandle.pushStreamDelta).toHaveBeenLastCalledWith(
      'text',
      's2-body',
    );
  });

  it('T-R8：mid-step 的 messages.length 变化不触发二次注入；step 提交或 mount 复位后才允许再注入', () => {
    const h = mountInject({
      chatSubview: 'conversation',
      sessionKey: 'p1:s1',
      sessionId: 's1',
      messagesLength: 3,
      partial: {text: 'abc', thinking: ''},
    });
    h.markReady();
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(1);
    // 外部事件强制 reload → messages.length 变化：不重注入（本 mount 已注入）
    h.rerender({messagesLength: 4});
    h.rerender({messagesLength: 5});
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(1);
    // step 提交重置注入标记后，messages.length 再变才允许下一次注入
    h.resetInjection();
    h.rerender({messagesLength: 6});
    expect(webHandle.pushStreamDelta).toHaveBeenCalledTimes(2);
  });
});

describe('useRunResumeProbe 双方向（T-R6）', () => {
  let spy: ReturnType<typeof jest.spyOn>;
  let appStateListener: (state: string) => void;

  beforeEach(() => {
    jest.useFakeTimers();
    appStateListener = () => undefined;
    spy = jest.spyOn(AppState, 'addEventListener');
    spy.mockImplementation((_e: unknown, cb: (state: string) => void) => {
      appStateListener = cb;
      return {remove: () => undefined} as unknown as {remove: () => void};
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    spy.mockRestore();
  });

  function flushTimers(ms: number) {
    return new Promise<void>(resolve => {
      setTimeout(resolve, ms);
      jest.advanceTimersByTime(ms);
    });
  }

  it('恢复方向：sessionId 生效且 registry 仍注册时触发 onRunActive', () => {
    const onRunActive = jest.fn();
    let r: TestRenderer.ReactTestRenderer | null = null;
    function Harness() {
      useRunResumeProbe({
        sessionId: 's1',
        isRunRegistered: () => true,
        onRunActive,
        onRunEnded: () => undefined,
        uiRunning: false,
        isRunActive: () => false,
      });
      return null;
    }
    act(() => {
      r = TestRenderer.create(React.createElement(Harness));
    });
    expect(onRunActive).toHaveBeenCalledTimes(1);
    act(() => {
      r!.unmount();
    });
  });

  it('T-R6 收尾校准：uiRunning=true 且 registry 已无时收尾；两次节点之间不感知变化', async () => {
    const onRunEnded = jest.fn();
    let registered = false;
    let r: TestRenderer.ReactTestRenderer | null = null;
    function Harness() {
      useRunResumeProbe({
        sessionId: 's1',
        isRunRegistered: () => registered,
        onRunActive: () => undefined,
        onRunEnded,
        uiRunning: true,
        isRunActive: () => true,
      });
      return null;
    }
    act(() => {
      r = TestRenderer.create(React.createElement(Harness));
    });
    // 节点之间（未触发探针）：registry 变 false 不被感知、不收尾
    registered = false;
    expect(onRunEnded).not.toHaveBeenCalled();
    // 探针节点触发：AppState 回前台 → 查 has=false → 复询防抖 800ms 后收尾
    act(() => {
      appStateListener('active');
    });
    await act(async () => {
      await flushTimers(800);
    });
    expect(onRunEnded).toHaveBeenCalledTimes(1);
    act(() => {
      r!.unmount();
    });
  });
});
