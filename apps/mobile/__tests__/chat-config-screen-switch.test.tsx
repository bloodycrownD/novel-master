/**
 * ChatConfigScreen 偏好开关持久化失败回滚（cr-fix-spec b2/B-3）：
 * 三个开关（流式输出 / 思考提示词 / 富文本消息）写入 reject 时
 * toast「保存失败」并把开关回滚到原值（实现选了「乐观更新 + 失败回滚」）。
 *
 * 另含消息通知开关回调与权限行三态的屏幕侧断言（cr-fix-spec ui/G-1，
 * 补 resident-keepalive spec T-K10 的 blocking 测试债）。
 *
 * 照 fetch-models-sheet.test.tsx 的 TestRenderer 直测风格；
 * ProfileSwitchItem mock 成可点击节点，文本里带 label 与当前值便于断言回滚。
 */
import React from 'react';
import {Platform} from 'react-native';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#f8f8f8',
      text: '#111',
      textSecondary: '#666',
      border: '#ccc',
      primary: '#007aff',
      danger: '#f00',
    },
  }),
}));

jest.mock('@react-navigation/native', () => {
  const mockReact = require('react');
  return {
    // 挂载时执行一次，对齐真实 focus 语义（每渲染都跑会触发 refresh 无限循环）
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockReact.useEffect(cb, []);
    },
    // ChatConfigScreen 经通知模块间接引入 navigation-container-ref 的
    // 模块级调用，mock 需提供该工厂防 suite 装载失败。
    createNavigationContainerRef: () => ({}),
  };
});

jest.mock('@/components/profile/ProfileSwitchItem', () => {
  const mockReact = require('react');
  const {Pressable, Text} = require('react-native');
  return {
    ProfileSwitchItem: (props: {
      label: string;
      value: boolean;
      onValueChange: (value: boolean) => void;
    }) =>
      mockReact.createElement(
        Pressable,
        {
          testID: `switch-${props.label}`,
          onPress: () => props.onValueChange(!props.value),
        },
        mockReact.createElement(
          Text,
          null,
          `${props.label}:${props.value ? '开' : '关'}`,
        ),
      ),
  };
});

// 权限行 mock（ui/G-1）：照 ProfileSwitchItem 的风格做成可点击节点，
// 文本带 label 与 value（三态文案的断言面）。
jest.mock('@/components/profile/ProfileMenuItem', () => {
  const mockReact = require('react');
  const {Pressable, Text} = require('react-native');
  return {
    ProfileMenuItem: (props: {
      label: string;
      value?: string;
      onPress: () => void;
    }) =>
      mockReact.createElement(
        Pressable,
        {
          testID: `menu-${props.label}`,
          onPress: props.onPress,
        },
        mockReact.createElement(
          Text,
          null,
          `${props.label}:${props.value ?? ''}`,
        ),
      ),
  };
});

jest.mock('@/components/form/FormField', () => ({FormField: () => null}));
jest.mock('@/components/form/FormSectionCard', () => ({
  FormSectionCard: () => null,
}));
jest.mock('@/components/form/FormTextInput', () => ({
  FormTextInput: () => null,
}));
jest.mock('@/components/form/StickyFormFooter', () => ({
  StickyFormFooter: () => null,
}));

jest.mock('@/components/form/ScreenFormLayout', () => {
  const mockReact = require('react');
  const {View} = require('react-native');
  return {
    ScreenFormLayout: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement(View, null, children),
  };
});

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

const mockShowToast = jest.fn();

const mockGetLlmStreamEnabled = jest.fn();
const mockSetLlmStreamEnabled = jest.fn();
const mockGetThinkingContextEnabled = jest.fn();
const mockSetThinkingContextEnabled = jest.fn();
const mockGetConditions = jest.fn();

const mockRuntime = {
  preferences: {
    getLlmStreamEnabled: mockGetLlmStreamEnabled,
    setLlmStreamEnabled: mockSetLlmStreamEnabled,
    getThinkingContextEnabled: mockGetThinkingContextEnabled,
    setThinkingContextEnabled: mockSetThinkingContextEnabled,
  },
  compactionConditions: {getConditions: mockGetConditions},
};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

const mockWriteChatRichTextEnabled = jest.fn();
const mockReadChatRichTextEnabled = jest.fn();
const mockAppUi = {get: jest.fn(), set: jest.fn()};

jest.mock('@/storage/chat-rich-text-pref', () => ({
  readChatRichTextEnabled: (...args: unknown[]) =>
    mockReadChatRichTextEnabled(...args),
  writeChatRichTextEnabled: (...args: unknown[]) =>
    mockWriteChatRichTextEnabled(...args),
}));

// 消息通知开关的存储与通知模块副作用（ui/G-1：ChatConfigScreen 直连的
// 新导出，全部 mock；平台门禁在服务内部，屏幕侧只断言调用接线）。
const mockReadMessageNotificationEnabled = jest.fn();
const mockWriteMessageNotificationEnabled = jest.fn();
const mockSetKeepAliveResidentEnabled = jest.fn();
const mockEnsureAgentNotificationPermission = jest.fn();
const mockGetAgentNotificationPermissionStatus = jest.fn();
const mockRequestAgentNotificationPermissionManually = jest.fn();

jest.mock('@/storage/message-notification-pref', () => ({
  readMessageNotificationEnabled: (...args: unknown[]) =>
    mockReadMessageNotificationEnabled(...args),
  writeMessageNotificationEnabled: (...args: unknown[]) =>
    mockWriteMessageNotificationEnabled(...args),
}));

jest.mock('@/services/agent-finished-notification', () => ({
  setKeepAliveResidentEnabled: (...args: unknown[]) =>
    mockSetKeepAliveResidentEnabled(...args),
  ensureAgentNotificationPermission: (...args: unknown[]) =>
    mockEnsureAgentNotificationPermission(...args),
  getAgentNotificationPermissionStatus: (...args: unknown[]) =>
    mockGetAgentNotificationPermissionStatus(...args),
  requestAgentNotificationPermissionManually: (...args: unknown[]) =>
    mockRequestAgentNotificationPermissionManually(...args),
}));

jest.mock('@/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({appUi: mockAppUi, status: 'ready'}),
}));

import {ChatConfigScreen} from '@/screens/stack/ChatConfigScreen';

/** 递归收集渲染树里全部展示文本（避开 toJSON 的循环引用）。 */
function treeText(
  node: TestRenderer.ReactTestInstance | string | number,
): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  let out = '';
  for (const child of node.children) {
    out += treeText(child);
  }
  return out;
}

function json(renderer: TestRenderer.ReactTestRenderer) {
  return treeText(renderer.root);
}

function findSwitch(
  root: TestRenderer.ReactTestInstance,
  label: string,
): TestRenderer.ReactTestInstance {
  const nodes = root.findAll(
    n => n.props && n.props.testID === `switch-${label}`,
  );
  // Pressable 会把 props 复制到内部 responder 节点，取最外层那个即可
  expect(nodes.length).toBeGreaterThanOrEqual(1);
  return nodes[0];
}

/** 同 findSwitch，找 ProfileMenuItem（权限行）的可点击节点。 */
function findMenu(
  root: TestRenderer.ReactTestInstance,
  label: string,
): TestRenderer.ReactTestInstance {
  const nodes = root.findAll(
    n => n.props && n.props.testID === `menu-${label}`,
  );
  expect(nodes.length).toBeGreaterThanOrEqual(1);
  return nodes[0];
}

/** 覆盖 Platform.OS 为指定平台；getter 描述符兼容 RN jest-preset 实现。 */
function setPlatform(os: 'android' | 'ios') {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    get: () => os,
  });
}

async function renderScreen() {
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatConfigScreen />);
  });
  return {renderer: renderer!};
}

/** 同步点一下开关（只 flush 渲染，不等持久化 promise），便于断言乐观翻转的中间态。 */
function toggleSwitchSync(root: TestRenderer.ReactTestInstance, label: string) {
  act(() => {
    findSwitch(root, label).props.onPress();
  });
}

/** 等持久化 promise 落定（reject 后的回滚也在此生效）。 */
async function flushPersist() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 点一下开关并等持久化 promise 落定（不断言中间态的用例用这个）。 */
async function toggleSwitchAsync(
  root: TestRenderer.ReactTestInstance,
  label: string,
) {
  toggleSwitchSync(root, label);
  await flushPersist();
}

describe('ChatConfigScreen 开关持久化失败回滚', () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockGetLlmStreamEnabled.mockReset().mockResolvedValue(false);
    mockSetLlmStreamEnabled.mockReset().mockResolvedValue(undefined);
    mockGetThinkingContextEnabled.mockReset().mockResolvedValue(false);
    mockSetThinkingContextEnabled.mockReset().mockResolvedValue(undefined);
    mockGetConditions.mockReset().mockResolvedValue({
      schemaVersion: 4,
      enabled: false,
      tokenRatio: 0.8,
      hideStartDepth: 6,
    });
    mockReadChatRichTextEnabled.mockReset().mockResolvedValue(false);
    mockWriteChatRichTextEnabled.mockReset().mockResolvedValue(undefined);
  });

  it('B-3: 流式输出写入失败回滚并 toast', async () => {
    mockSetLlmStreamEnabled.mockRejectedValueOnce(new Error('盘炸了'));
    const {renderer} = await renderScreen();
    expect(json(renderer)).toContain('流式输出:关');

    toggleSwitchSync(renderer.root, '流式输出');
    expect(json(renderer)).toContain('流式输出:开');

    // reject 落定后回滚到原值
    await flushPersist();
    expect(json(renderer)).toContain('流式输出:关');
    expect(mockShowToast).toHaveBeenCalledWith('保存失败：盘炸了');
  });

  it('B-3: 思考提示词写入失败回滚并 toast', async () => {
    mockSetThinkingContextEnabled.mockRejectedValueOnce(new Error('盘炸了'));
    const {renderer} = await renderScreen();

    await toggleSwitchAsync(renderer.root, '思考提示词');
    expect(json(renderer)).toContain('思考提示词:关');
    expect(mockShowToast).toHaveBeenCalledWith('保存失败：盘炸了');
  });

  it('B-3: 富文本消息写入失败回滚并 toast', async () => {
    mockWriteChatRichTextEnabled.mockRejectedValueOnce(new Error('盘炸了'));
    const {renderer} = await renderScreen();

    await toggleSwitchAsync(renderer.root, '富文本消息');
    expect(json(renderer)).toContain('富文本消息:关');
    expect(mockShowToast).toHaveBeenCalledWith('保存失败：盘炸了');
  });

  it('B-3: 写入成功保持新值且不 toast', async () => {
    const {renderer} = await renderScreen();
    expect(json(renderer)).toContain('流式输出:关');

    toggleSwitchSync(renderer.root, '流式输出');
    await flushPersist();
    expect(json(renderer)).toContain('流式输出:开');
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});

// ── 消息通知开关回调与权限行（cr-fix-spec ui/G-1，T-K10 屏幕侧）──────────

describe('ChatConfigScreen 消息通知开关与权限行（ui/G-1）', () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockGetLlmStreamEnabled.mockReset().mockResolvedValue(false);
    mockSetLlmStreamEnabled.mockReset().mockResolvedValue(undefined);
    mockGetThinkingContextEnabled.mockReset().mockResolvedValue(false);
    mockSetThinkingContextEnabled.mockReset().mockResolvedValue(undefined);
    mockGetConditions.mockReset().mockResolvedValue({
      schemaVersion: 4,
      enabled: false,
      tokenRatio: 0.8,
      hideStartDepth: 6,
    });
    mockReadChatRichTextEnabled.mockReset().mockResolvedValue(false);
    mockWriteChatRichTextEnabled.mockReset().mockResolvedValue(undefined);
    mockReadMessageNotificationEnabled.mockReset().mockResolvedValue(false);
    mockWriteMessageNotificationEnabled.mockReset().mockResolvedValue(undefined);
    mockSetKeepAliveResidentEnabled.mockReset().mockResolvedValue(undefined);
    mockEnsureAgentNotificationPermission.mockReset().mockResolvedValue(true);
    mockGetAgentNotificationPermissionStatus
      .mockReset()
      .mockResolvedValue('authorized');
    mockRequestAgentNotificationPermissionManually
      .mockReset()
      .mockResolvedValue('authorized');
    // RN jest-preset 默认 ios；权限行相关用例自行切 android。
    setPlatform('ios');
  });

  it('T-K10: 开关开 persist 成功 → setKeepAliveResidentEnabled(true) 被调且不回滚；关→开附带 ensureAgentNotificationPermission', async () => {
    // 开关行为与平台无关（resident 的平台门禁在服务内部，已 mock）。
    const {renderer} = await renderScreen();
    expect(json(renderer)).toContain('消息通知:关');

    // 关 → 开：存储先持久化成功，通知模块副作用照常接线
    await toggleSwitchAsync(renderer.root, '消息通知');
    expect(mockWriteMessageNotificationEnabled).toHaveBeenCalledWith(
      mockAppUi,
      true,
    );
    expect(mockSetKeepAliveResidentEnabled).toHaveBeenCalledWith(true);
    // persist 成功不回滚：开关保持新值
    expect(json(renderer)).toContain('消息通知:开');
    // 关→开附带权限申请（拒绝过一次后不再自动弹的入口前移）
    expect(mockEnsureAgentNotificationPermission).toHaveBeenCalledTimes(1);

    // 开 → 关：不再附带权限申请，常驻开关同步关
    await toggleSwitchAsync(renderer.root, '消息通知');
    expect(mockSetKeepAliveResidentEnabled).toHaveBeenLastCalledWith(false);
    expect(mockEnsureAgentNotificationPermission).toHaveBeenCalledTimes(1);
    expect(json(renderer)).toContain('消息通知:关');
  });

  it('T-K10: 权限行 authorized / denied / checking 三态文案', async () => {
    setPlatform('android');
    // 同一用例内三段挂载/卸载，每段照 renderScreen 的 act 包裹（create 与
    // 挂载期 refresh 链都在 act 内落定，避免 act 外 setState 告警）。
    const renderOnce = async () => {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(<ChatConfigScreen />);
      });
      return renderer;
    };

    mockGetAgentNotificationPermissionStatus.mockResolvedValue('authorized');
    let renderer = await renderOnce();
    expect(json(renderer)).toContain('通知权限:已授权');
    act(() => {
      renderer.unmount();
    });

    mockGetAgentNotificationPermissionStatus.mockResolvedValue('denied');
    renderer = await renderOnce();
    expect(json(renderer)).toContain('通知权限:未授权');
    act(() => {
      renderer.unmount();
    });

    // 查询不落定 → 首帧占位 checking（「申请中…」）
    mockGetAgentNotificationPermissionStatus.mockReturnValue(
      new Promise<never>(() => undefined),
    );
    renderer = await renderOnce();
    expect(json(renderer)).toContain('通知权限:申请中…');
    act(() => {
      renderer.unmount();
    });
  });

  it('T-K10: denied 点击走 requestAgentNotificationPermissionManually 并按回执更新', async () => {
    setPlatform('android');
    mockGetAgentNotificationPermissionStatus.mockResolvedValue('denied');
    const {renderer} = await renderScreen();
    expect(json(renderer)).toContain('通知权限:未授权');

    // 手动申请回执 authorized：权限行按回执翻新
    mockRequestAgentNotificationPermissionManually.mockResolvedValue(
      'authorized',
    );
    act(() => {
      findMenu(renderer.root, '通知权限').props.onPress();
    });
    // 点击后即时切 checking（手动申请中的防重入标记）
    expect(json(renderer)).toContain('通知权限:申请中…');
    await flushPersist();
    expect(
      mockRequestAgentNotificationPermissionManually,
    ).toHaveBeenCalledTimes(1);
    expect(json(renderer)).toContain('通知权限:已授权');
  });

  it('T-K10: checking 态点击不重复发起手动申请（防重入）', async () => {
    setPlatform('android');
    // 权限查询不落定 → 权限行停留在 checking
    mockGetAgentNotificationPermissionStatus.mockReturnValue(
      new Promise<never>(() => undefined),
    );
    const {renderer} = await renderScreen();
    expect(json(renderer)).toContain('通知权限:申请中…');

    act(() => {
      findMenu(renderer.root, '通知权限').props.onPress();
    });
    await flushPersist();
    // checking（含 authorized）非 denied：点击早退，不发起手动申请
    expect(
      mockRequestAgentNotificationPermissionManually,
    ).not.toHaveBeenCalled();
  });

  it('T-K10: iOS 权限行不渲染', async () => {
    setPlatform('ios');
    const {renderer} = await renderScreen();
    expect(json(renderer)).not.toContain('通知权限:');
    // iOS 不查询权限状态（平台门禁在屏幕侧的读取口）
    expect(mockGetAgentNotificationPermissionStatus).not.toHaveBeenCalled();
  });
});
