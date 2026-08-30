/**
 * ChatConfigScreen 偏好开关持久化失败回滚（cr-fix-spec b2/B-3）：
 * 四个开关（流式输出 / 思考提示词 / 会话版本校验 / 富文本消息）写入 reject 时
 * toast「保存失败」并把开关回滚到原值（实现选了「乐观更新 + 失败回滚」）。
 *
 * 照 fetch-models-sheet.test.tsx 的 TestRenderer 直测风格；
 * ProfileSwitchItem mock 成可点击节点，文本里带 label 与当前值便于断言回滚。
 */
import React from 'react';
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

jest.mock('@novel-master/core/config-forms/shared', () => ({
  SESSION_FS_LABELS: {
    title: '会话版本校验',
    enabledHint: '开启提示',
    disabledHint: '关闭提示',
  },
}));

const mockShowToast = jest.fn();

const mockGetLlmStreamEnabled = jest.fn();
const mockSetLlmStreamEnabled = jest.fn();
const mockGetThinkingContextEnabled = jest.fn();
const mockSetThinkingContextEnabled = jest.fn();
const mockGetSessionFsVersionCheck = jest.fn();
const mockSetSessionFsVersionCheck = jest.fn();
const mockGetConditions = jest.fn();

const mockRuntime = {
  preferences: {
    getLlmStreamEnabled: mockGetLlmStreamEnabled,
    setLlmStreamEnabled: mockSetLlmStreamEnabled,
    getThinkingContextEnabled: mockGetThinkingContextEnabled,
    setThinkingContextEnabled: mockSetThinkingContextEnabled,
    getSessionFsVersionCheck: mockGetSessionFsVersionCheck,
    setSessionFsVersionCheck: mockSetSessionFsVersionCheck,
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

async function renderScreen() {
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatConfigScreen />);
  });
  return {renderer: renderer!};
}

/** 同步点一下开关（只 flush 渲染，不等持久化 promise），便于断言乐观翻转的中间态。 */
function toggleSwitchSync(
  root: TestRenderer.ReactTestInstance,
  label: string,
) {
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
    mockGetSessionFsVersionCheck.mockReset().mockResolvedValue(false);
    mockSetSessionFsVersionCheck.mockReset().mockResolvedValue(undefined);
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

  it('B-3: 会话版本校验写入失败回滚并 toast', async () => {
    mockSetSessionFsVersionCheck.mockRejectedValueOnce(new Error('盘炸了'));
    const {renderer} = await renderScreen();

    await toggleSwitchAsync(renderer.root, '会话版本校验');
    expect(json(renderer)).toContain('会话版本校验:关');
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
