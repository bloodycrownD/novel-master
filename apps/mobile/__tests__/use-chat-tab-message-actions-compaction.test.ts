/**
 * T-S14：手动压缩的真实取消入口（signal-abort-scope Step 14）。
 *
 * 聊天页压缩入口此前只有「确认开始压缩」，压缩跑起来后没有取消入口；
 * 八期在 runManualCompaction 接了 scope / ABORT_KEY.compaction 后，本套件钉住：
 * - 压缩在途经 action toast 挂出「取消压缩」，点击经 abortRegistry 派发到
 *   runManualCompaction 注册的 scope；
 * - AbortError 被调用方收掉（不产生 unhandled rejection），只留「已取消压缩」
 *   提示、不弹错误 toast，在途标记复位；
 * - 在途再点「压缩上下文」不重复发起（重复 register 会覆盖旧 scope）；
 * - 成功语义不变（「已压缩」）。不可中断窗口内的取消由 core 侧 checkpoint
 *   位置保证（见 manual-compaction.test.ts 的 T-S16）。
 *
 * unhandled rejection 的检测口径：本仓 Jest 环境下 vm 内 promise 不触发
 * process 级 `unhandledRejection` 监听（已用探针验证），但 Jest 自己会把
 * 未处理的 rejection 直接判该用例失败。因此断言方式为「取消出口的 catch
 * 分支确实执行」（只有 rejection 被同步接住才会走到「已取消压缩」提示），
 * 变异验证：把调用侧的 .catch 去掉后本套件两条取消用例立即变红
 * （Jest 报 `AbortError: Request aborted`）。
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {ABORT_KEY, AbortRegistryFactory} from '@novel-master/core/abort';
import {useChatTabMessageActions} from '@/screens/tabs/chat-tab/useChatTabMessageActions';

const mockRunCompaction = jest.fn();
const mockGetHideStartDepth = jest.fn();
const mockReloadMessages = jest.fn();
const mockRefreshChatTokenLabel = jest.fn();
const mockShowToast = jest.fn();

jest.mock('@novel-master/core/compaction', () => ({
  Compaction: {run: (...args: unknown[]) => mockRunCompaction(...args)},
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {setString: jest.fn()},
}));

jest.mock('@/services/project-composer-status.service', () => ({
  refreshComposerStatusAfterFloorOrCompaction: jest.fn(async () => undefined),
  refreshComposerStatusAfterSessionKkvCleared: jest.fn(async () => undefined),
}));

jest.mock('@/services/message-rollback.service', () => ({
  rollbackToMessage: jest.fn(),
}));

jest.mock('react-native', () => ({
  Alert: {
    alert: jest.fn((_title: string, _message: string, buttons: {text: string; onPress?: () => void}[]) => {
      buttons.find(b => b.text === '压缩')?.onPress?.();
    }),
  },
}));

type ToastOptions = {actionLabel?: string; onAction?: () => void};
type ToastCall = [string, ToastOptions | undefined];

function toastCalls(): ToastCall[] {
  return mockShowToast.mock.calls as unknown as ToastCall[];
}

function deferred<T>(): {promise: Promise<T>; resolve: (value: T) => void} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return {promise, resolve};
}

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function makeRuntime() {
  return {
    // 真实注册表：断言取消确实派发到 runManualCompaction 注册的 scope。
    abortRegistry: AbortRegistryFactory.create(),
    compactionConditionEvaluator: {getHideStartDepth: (...args: unknown[]) => mockGetHideStartDepth(...args)},
    sessionKkv: {get: jest.fn(), set: jest.fn(), delete: jest.fn()},
    messages: {listBySession: jest.fn()},
    messageTranscriptEffects: {},
  };
}

function mountActions(runtime: unknown) {
  let api!: ReturnType<typeof useChatTabMessageActions>;
  function Harness() {
    api = useChatTabMessageActions({
      runtime: runtime as never,
      projectId: 'p1',
      sessionId: 's1',
      chatMessages: [],
      reloadMessages: mockReloadMessages,
      setDraftRestoreToken: jest.fn(),
      agentRunning: false,
      resetStreamingDisplay: jest.fn(),
      showToast: mockShowToast,
      refreshChatTokenLabel: mockRefreshChatTokenLabel,
      bumpWorktreeUiToken: jest.fn(),
      reloadLists: jest.fn(),
      setCurrentSession: jest.fn(),
      setChatSubview: jest.fn(),
      setConversationPanel: jest.fn(),
      setMessageEditPrompt: jest.fn(),
    });
    return null;
  }
  act(() => {
    TestRenderer.create(React.createElement(Harness));
  });
  return api;
}

describe('useChatTabMessageActions 手动压缩取消入口（T-S14）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHideStartDepth.mockResolvedValue({ok: true, value: 3});
    mockRunCompaction.mockResolvedValue({ok: true});
    mockReloadMessages.mockResolvedValue(undefined);
    mockRefreshChatTokenLabel.mockResolvedValue(undefined);
  });

  it('T-S14-1：在途 action toast 挂出取消入口，点击派发 ABORT_KEY.compaction；取消出口无 unhandled rejection 且状态复位', async () => {
    const runtime = makeRuntime();
    const depth = deferred<{ok: true; value: number}>();
    mockGetHideStartDepth.mockReturnValue(depth.promise);
    const abortSpy = jest.spyOn(runtime.abortRegistry, 'abort');
    const api = mountActions(runtime);

    act(() => api.handleCompactSession());

    // 确认框已自动确认：取消入口经 action toast 挂出（本屏反馈面就是 toast）。
    const cancelEntry = toastCalls().find(([, options]) => options?.actionLabel === '取消压缩');
    expect(cancelEntry).toBeDefined();
    const scope = runtime.abortRegistry.get(ABORT_KEY.compaction('s1'));
    expect(scope).not.toBeNull();
    // 入口检查点已过，正卡在「深度读回、hide 开始前」的可中断窗口。
    expect(mockRunCompaction).not.toHaveBeenCalled();

    // 点「取消压缩」→ 经注册表派发到 runManualCompaction 注册的 scope。
    act(() => cancelEntry![1]!.onAction!());
    expect(abortSpy).toHaveBeenCalledWith(ABORT_KEY.compaction('s1'));
    expect(scope!.reason).toBe('user-stop');

    // 深度读回 → beforeHide 检查点命中取消 → 边界 throw AbortError.create()。
    await act(async () => {
      depth.resolve({ok: true, value: 3});
      await flushPromises();
      await flushPromises();
    });

    expect(mockRunCompaction).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('已取消压缩');
    // 取消不是失败：不弹「压缩失败」错误 toast。
    expect(toastCalls().some(([message]) => String(message).includes('压缩失败'))).toBe(false);
    // finally 反注册：key 不残留（否则后续同会话压缩会被旧 scope 污染）。
    expect(runtime.abortRegistry.has(ABORT_KEY.compaction('s1'))).toBe(false);
    // 「已取消压缩」只可能由 .catch 的 AbortError 分支吐出——这条断言即证明
    // 取消 rejection 被同步接住（漏 catch 时 Jest 会直接判本用例失败）。
    await flushPromises();

    // 在途标记复位：再点「压缩上下文」弹的是新的确认框，不是重挂取消入口。
    const alert = (require('react-native') as {Alert: {alert: jest.Mock}}).Alert.alert;
    expect(alert).toHaveBeenCalledTimes(1);
    act(() => api.handleCompactSession());
    expect(alert).toHaveBeenCalledTimes(2);

    // 收尾：这一次也走取消，避免悬挂的 promise 跨用例。
    act(() =>
      toastCalls()
        .filter(([, options]) => options?.actionLabel === '取消压缩')
        .at(-1)![1]!.onAction!(),
    );
    await act(async () => {
      await flushPromises();
      await flushPromises();
    });
  });

  it('T-S14-2：在途再点「压缩上下文」不重复发起，只把取消入口重新挂出来', async () => {
    const runtime = makeRuntime();
    const depth = deferred<{ok: true; value: number}>();
    mockGetHideStartDepth.mockReturnValue(depth.promise);
    const api = mountActions(runtime);
    const alert = (require('react-native') as {Alert: {alert: jest.Mock}}).Alert.alert;

    act(() => api.handleCompactSession());
    expect(alert).toHaveBeenCalledTimes(1);

    act(() => api.handleCompactSession());

    // 不弹第二次确认框、不重读深度、不重复 register（重复 register 会覆盖
    // 旧 scope，旧 scope 的取消即失效）。
    expect(alert).toHaveBeenCalledTimes(1);
    expect(mockGetHideStartDepth).toHaveBeenCalledTimes(1);
    expect(toastCalls().filter(([, options]) => options?.actionLabel === '取消压缩')).toHaveLength(2);

    // 收尾：取消并放开深度读，让 promise 正常 settle。
    act(() => toastCalls().filter(([, options]) => options?.actionLabel === '取消压缩')[1]![1]!.onAction!());
    await act(async () => {
      depth.resolve({ok: true, value: 3});
      await flushPromises();
      await flushPromises();
    });
  });

  it('T-S14-3：压缩成功仍走原成功语义（「已压缩」，无取消误报）', async () => {
    const runtime = makeRuntime();
    const api = mountActions(runtime);

    await act(async () => {
      api.handleCompactSession();
      await flushPromises();
      await flushPromises();
    });

    expect(mockRunCompaction).toHaveBeenCalledTimes(1);
    expect(mockReloadMessages).toHaveBeenCalledWith(true);
    expect(mockShowToast).toHaveBeenCalledWith('已压缩');
    expect(toastCalls().some(([message]) => message === '已取消压缩')).toBe(false);
  });
});
