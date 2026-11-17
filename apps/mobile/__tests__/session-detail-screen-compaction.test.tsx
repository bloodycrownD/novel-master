/**
 * T-S14：会话详情页手动压缩的真实取消入口（signal-abort-scope Step 14）。
 *
 * 详情页压缩入口此前只有「确认开始压缩」，压缩跑起来后没有取消入口；八期在
 * runManualCompaction 接了 scope / ABORT_KEY.compaction 后，本套件钉住：
 * - 压缩在途时压缩卡片就地换成「取消压缩」入口，点击经 abortRegistry 派发到
 *   已注册的 scope；
 * - AbortError 被调用方收掉（不产生 unhandled rejection），只留「已取消压缩」
 *   提示、不弹错误 toast，在途状态复位（卡片回到常态）；
 * - 成功语义不变（「已压缩」+ session-transcript-changed 广播）。
 *
 * unhandled rejection 的检测口径：本仓 Jest 环境下 vm 内 promise 不触发
 * process 级 `unhandledRejection` 监听（已用探针验证），但 Jest 自己会把
 * 未处理的 rejection 直接判该用例失败。因此断言方式为「取消出口的 catch
 * 分支确实执行」（只有 rejection 被同步接住才会走到「已取消压缩」提示），
 * 变异验证：把调用侧的 .catch 去掉后本条用例立即变红。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

import {ABORT_KEY, createAbortRegistry} from '@novel-master/core/abort';

const mockSessionsGet = jest.fn(async () => ({
  ok: true as const,
  value: {id: 's1', title: '我的会话'},
}));
const mockSessionsRename = jest.fn(async () => undefined);
const mockSessionsGetSessionAgentConfig = jest.fn(async () => ({ok: true as const, value: {agentId: 'workspace-agent'}}));
const mockSessionsUpdateSessionAgentConfig = jest.fn(async () => ({agentId: 'workspace-agent'}));
const mockStateGetCurrentAgentId = jest.fn(async () => ({ok: true as const, value: 'workspace-agent'}));
const mockStateGetCurrentModelId = jest.fn(async () => ({ok: true as const, value: 'model-ws'}));
const mockStateSetCurrentModelId = jest.fn(async () => undefined);
const mockStateSetCurrentAgentId = jest.fn(async () => undefined);
const mockEffectiveSkills = jest.fn(async () => []);
const mockLoadChatAgentMeta = jest.fn();
const mockShowToast = jest.fn();
const mockGetHideStartDepth = jest.fn();
const mockRunCompaction = jest.fn();

jest.mock('@novel-master/core/compaction', () => ({
  runCompaction: (...args: unknown[]) => mockRunCompaction(...args),
}));

const mockRuntime = {
  // 真实注册表：断言取消确实派发到 runManualCompaction 注册的 scope。
  abortRegistry: createAbortRegistry(),
  compactionConditionEvaluator: {getHideStartDepth: (...args: unknown[]) => mockGetHideStartDepth(...args)},
  sessionKkv: {get: jest.fn(), set: jest.fn(), delete: jest.fn()},
  messages: {listBySession: jest.fn()},
  messageTranscriptEffects: {},
  sessions: {
    get: mockSessionsGet,
    rename: mockSessionsRename,
    getSessionAgentConfig: mockSessionsGetSessionAgentConfig,
    updateSessionAgentConfig: mockSessionsUpdateSessionAgentConfig,
  },
  state: {
    getCurrentAgentId: mockStateGetCurrentAgentId,
    getCurrentModelId: mockStateGetCurrentModelId,
    setCurrentModelId: mockStateSetCurrentModelId,
    setCurrentAgentId: mockStateSetCurrentAgentId,
  },
  skills: () => ({effectiveSkills: mockEffectiveSkills}),
};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#f5f5f5',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ddd',
      borderLight: '#eee',
      primary: '#007aff',
      danger: '#f00',
    },
  }),
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('@/errors/toast-message', () => ({
  toastMessage: (title: string, err?: unknown) => (err === undefined ? title : `${title}:${String(err)}`),
}));

jest.mock('@/services/chat-agent-meta', () => ({
  loadChatAgentMeta: (...args: unknown[]) => mockLoadChatAgentMeta(...args),
  isAgentLocked: (agentMeta: {source?: string} | undefined) => agentMeta == null,
  isAgentDeleted: (agentMeta: {source?: string} | undefined) => agentMeta != null && agentMeta.source === 'none',
  isModelLocked: () => false,
  AGENT_LOCK_TOAST_STATEMENT: '智能体信息加载中，请稍候再试',
  AGENT_RESELECT_HINT: '智能体已删除 · 点击重选',
  MODEL_LOCK_TOAST: '当前智能体已锁定模型，会话内无法覆盖',
}));

jest.mock('@/runtime/agent-activity', () => ({
  isMobileAgentActive: () => false,
}));

jest.mock('@/services/project-composer-status.service', () => ({
  refreshComposerStatusAfterFloorOrCompaction: jest.fn(async () => undefined),
}));

jest.mock('@/components/agent/AgentPickerModal', () => {
  const ReactModule = require('react');
  return {AgentPickerModal: (props: {visible: boolean}) => ReactModule.createElement('View', {testID: 'agent-picker-modal', visible: String(props.visible)})};
});

jest.mock('@/components/provider/ModelPickerModal', () => {
  const ReactModule = require('react');
  return {ModelPickerModal: (props: {visible: boolean}) => ReactModule.createElement('View', {testID: 'model-picker-modal', visible: String(props.visible)})};
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({params: {projectId: 'p1', sessionId: 's1'}}),
  useNavigation: () => ({navigate: mockNavigate, goBack: mockGoBack}),
  useFocusEffect: () => undefined,
}));

jest.mock('react-native', () => {
  const RnReact = require('react');
  return {
    ScrollView: ({children, testID}: {children?: React.ReactNode; testID?: string}) => RnReact.createElement('View', {testID}, children),
    TextInput: (props: Record<string, unknown>) => RnReact.createElement('TextInput', props),
    Pressable: (props: {children?: React.ReactNode; onPress?: () => void; accessibilityLabel?: string; testID?: string}) =>
      RnReact.createElement('View', {testID: props.testID ?? props.accessibilityLabel, onPress: props.onPress}, props.children),
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Platform: {OS: 'ios'},
    Text: ({children, testID}: {children?: React.ReactNode; testID?: string}) => RnReact.createElement('Text', {testID}, children),
    View: ({children, testID}: {children?: React.ReactNode; testID?: string}) => RnReact.createElement('View', {testID}, children),
    DeviceEventEmitter: {emit: jest.fn()},
    // 确认框自动点「压缩」：被测的是压缩在途的取消入口，不是确认框本身。
    Alert: {
      alert: jest.fn((_title: string, _message: string, buttons: {text: string; onPress?: () => void}[]) => {
        buttons?.find(b => b.text === '压缩')?.onPress?.();
      }),
    },
  };
});

import {SessionDetailScreen} from '@/screens/stack/SessionDetailScreen';
import type {ChatAgentMeta} from '@/services/chat-agent-meta';

function meta(): ChatAgentMeta {
  return {
    source: 'session',
    agentId: 'agent-a',
    agentName: 'Alpha',
    modelLabel: 'Model-1',
    tokenLabel: '',
    hasDedicatedModel: false,
    modelSource: 'session',
  };
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

describe('SessionDetailScreen 手动压缩取消入口（T-S14）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionsGet.mockResolvedValue({ok: true, value: {id: 's1', title: '我的会话'}});
    mockLoadChatAgentMeta.mockResolvedValue({ok: true, value: meta()});
    mockGetHideStartDepth.mockResolvedValue({ok: true, value: 3});
    mockRunCompaction.mockResolvedValue({ok: true});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('T-S14-4：压缩在途卡片就地换成取消入口，取消经 registry 派发、无 unhandled rejection 且状态复位', async () => {
    const depth = deferred<{ok: true; value: number}>();
    mockGetHideStartDepth.mockReturnValue(depth.promise);
    const abortSpy = jest.spyOn(mockRuntime.abortRegistry, 'abort');

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });

    // 点压缩卡片 → 确认框（mock 自动确认）→ 进入在途态。
    await act(async () => {
      tree.root.findByProps({testID: 'compact-row'}).props.onPress();
      await flushPromises();
    });

    // 在途：常态卡片收起，同一位置换成取消入口。
    // （RN mock 里 Pressable 与它渲染出的宿主 View 都带 testID，命中数 > 0 即可。）
    expect(tree.root.findAllByProps({testID: 'compact-row'})).toHaveLength(0);
    const cancelRows = tree.root.findAllByProps({testID: 'compact-cancel-row'});
    expect(cancelRows.length).toBeGreaterThan(0);
    const cancelRow = cancelRows[0]!;
    const jsonInFlight = JSON.stringify(tree.toJSON());
    expect(jsonInFlight).toContain('正在压缩…');
    expect(jsonInFlight).toContain('取消');
    const scope = mockRuntime.abortRegistry.get(ABORT_KEY.compaction('s1'));
    expect(scope).not.toBeNull();
    expect(mockRunCompaction).not.toHaveBeenCalled();

    // 点取消入口 → 经注册表派发到 runManualCompaction 注册的 scope。
    await act(async () => {
      cancelRow.props.onPress();
      await flushPromises();
    });
    expect(abortSpy).toHaveBeenCalledWith(ABORT_KEY.compaction('s1'));
    expect(scope!.reason).toBe('user-stop');

    // 深度读回 → beforeHide 检查点命中取消 → 边界 throw createAbortError()。
    await act(async () => {
      depth.resolve({ok: true, value: 3});
      await flushPromises();
      await flushPromises();
      await flushPromises();
    });

    expect(mockRunCompaction).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('已取消压缩');
    // 取消不是失败：不弹错误 toast。
    expect(mockShowToast.mock.calls.some(([message]) => String(message).includes('压缩失败'))).toBe(false);
    // 「已取消压缩」只可能由 .catch 的 AbortError 分支吐出——这条断言即证明
    // 取消 rejection 被同步接住（漏 catch 时 Jest 会直接判本用例失败）。
    await flushPromises();
    // 状态复位：取消入口收起，压缩卡片回到常态；scope 已反注册。
    expect(tree.root.findAllByProps({testID: 'compact-cancel-row'})).toHaveLength(0);
    expect(tree.root.findAllByProps({testID: 'compact-row'}).length).toBeGreaterThan(0);
    expect(mockRuntime.abortRegistry.has(ABORT_KEY.compaction('s1'))).toBe(false);
  });

  it('T-S14-5：压缩成功仍走原成功语义（「已压缩」+ session-transcript-changed 广播）', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });

    await act(async () => {
      tree.root.findByProps({testID: 'compact-row'}).props.onPress();
      await flushPromises();
      await flushPromises();
      await flushPromises();
    });

    expect(mockRunCompaction).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('已压缩');
    expect(mockShowToast.mock.calls.some(([message]) => message === '已取消压缩')).toBe(false);
    const {DeviceEventEmitter} = require('react-native') as {DeviceEventEmitter: {emit: jest.Mock}};
    expect(DeviceEventEmitter.emit).toHaveBeenCalledWith('session-transcript-changed', {sessionId: 's1'});
    // 成功出口同样收起取消入口。
    expect(tree.root.findAllByProps({testID: 'compact-cancel-row'})).toHaveLength(0);
    expect(tree.root.findAllByProps({testID: 'compact-row'}).length).toBeGreaterThan(0);
  });
});
