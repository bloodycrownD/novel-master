/**
 * SearchEnginesScreen 保存失败回读（cr-fix-spec ui/B-3）：
 * 保存中途部分提交已生效（如 bocha key 已写入而 setSearxngBaseUrl 失败）时，
 * toast「保存失败」后须立即回读（catch 内补 `await load()`），状态标签
 * 反映已生效的 configured——与 desktop 93f534ea 口径对齐。
 *
 * 照 chat-config-screen-switch.test.tsx 的 TestRenderer 直测风格：
 * 输入框 / 保存按钮 / 状态标签 mock 成带标记的可交互节点，树文本断言。
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
      textTertiary: '#999',
      border: '#ccc',
      primary: '#007aff',
      danger: '#f00',
    },
  }),
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

const mockShowToast = jest.fn();

// 状态标签：输出状态文本，断言回读后 set / not set 翻转。
jest.mock('@/components/provider/ApiKeyStatusTag', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    ApiKeyStatusTag: (props: {status: 'set' | 'not set'}) =>
      mockReact.createElement(Text, {tag: props.status}, `tag:${props.status}`),
  };
});

// 表单骨架透传（卡片同时透传 rightAction，保住状态标签在树里）。
jest.mock('@/components/form/FormSectionCard', () => {
  const mockReact = require('react');
  const {View} = require('react-native');
  return {
    FormSectionCard: (props: {
      children?: React.ReactNode;
      rightAction?: React.ReactNode;
    }) =>
      mockReact.createElement(View, null, props.rightAction, props.children),
  };
});

jest.mock('@/components/form/FormField', () => {
  const mockReact = require('react');
  const {View} = require('react-native');
  return {
    FormField: (props: {children?: React.ReactNode}) =>
      mockReact.createElement(View, null, props.children),
  };
});

jest.mock('@/components/form/FormChipGroup', () => ({
  FormChipGroup: () => null,
}));

jest.mock('@/components/form/ScreenFormLayout', () => {
  const mockReact = require('react');
  const {View} = require('react-native');
  return {
    // children 与 footer（保存按钮所在）都透传进树。
    ScreenFormLayout: (props: {
      children?: React.ReactNode;
      footer?: React.ReactNode;
    }) => mockReact.createElement(View, null, props.children, props.footer),
  };
});

// 保存按钮：可点节点触发 handleSave。
jest.mock('@/components/form/StickyFormFooter', () => {
  const mockReact = require('react');
  const {Pressable, Text} = require('react-native');
  return {
    StickyFormFooter: (props: {onPress: () => void; label: string}) =>
      mockReact.createElement(
        Pressable,
        {onPress: props.onPress},
        mockReact.createElement(Text, null, props.label),
      ),
  };
});

jest.mock('@/components/ui/Buttons', () => ({
  SecondaryButton: () => null,
}));

// 输入框：key 输入（secureTextEntry）标记可辨，onChangeText 挂到
// props 上供测试直接触发；渲染顺序即 KEY_ENGINE_IDS 顺序
// （bocha / tavily / brave），定位靠 findAllByType(FormTextInput)。
jest.mock('@/components/form/FormTextInput', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    FormTextInput: (props: {
      onChangeText: (text: string) => void;
      secureTextEntry?: boolean;
    }) => mockReact.createElement(Text, {onChangeText: props.onChangeText}, ''),
  };
});

// searchConfig store mock：readConfig 的 bocha 状态随 saveEngineKey 调用
// 次数动态变化，模拟「key 已落库生效」的半程状态。
const mockSaveEngineKey = jest.fn();
const mockClearEngineKey = jest.fn();
const mockSetSearxngBaseUrl = jest.fn();
const mockSetDefaultEngine = jest.fn();
const mockReadConfig = jest.fn();

const mockRuntime = {
  searchConfig: {
    readConfig: (...args: unknown[]) => mockReadConfig(...args),
    saveEngineKey: (...args: unknown[]) => mockSaveEngineKey(...args),
    clearEngineKey: (...args: unknown[]) => mockClearEngineKey(...args),
    setSearxngBaseUrl: (...args: unknown[]) => mockSetSearxngBaseUrl(...args),
    setDefaultEngine: (...args: unknown[]) => mockSetDefaultEngine(...args),
  },
};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

import {SearchEnginesScreen} from '@/screens/stack/SearchEnginesScreen';
// 被替换后的 mock 组件引用：用 findAllByType 精确定位（RN 宿主组件会把
// 自定义 props 复制到内部嵌套节点，按 props findAll 会重复匹配）。
import {FormTextInput} from '@/components/form/FormTextInput';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';

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

/** 取第 index 个 key 输入框（渲染顺序 = KEY_ENGINE_IDS：0=bocha）。 */
function keyInput(
  root: TestRenderer.ReactTestInstance,
  index: number,
): TestRenderer.ReactTestInstance {
  const nodes = root
    .findAllByType(FormTextInput)
    .filter(n => n.props.secureTextEntry);
  expect(nodes.length).toBe(3);
  return nodes[index];
}

function saveFooter(root: TestRenderer.ReactTestInstance) {
  return root.findByType(StickyFormFooter);
}

async function renderScreen() {
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<SearchEnginesScreen />);
  });
  return {renderer: renderer!};
}

/** 输入 draft（单独 act flush 重渲染，保证 handleSave 闭包捕获新 draft）。 */
async function typeKey(
  root: TestRenderer.ReactTestInstance,
  index: number,
  text: string,
) {
  await act(async () => {
    keyInput(root, index).props.onChangeText(text);
  });
}

/** 点保存并 flush 整条 async 链（含 catch 内回读的 load）。 */
async function tapSave(root: TestRenderer.ReactTestInstance) {
  await act(async () => {
    saveFooter(root).props.onPress();
    // saveEngineKey → setSearxngBaseUrl →（catch）load 内 readConfig 的
    // promise 链逐级 await，多轮 microtask 全部落定。
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

describe('SearchEnginesScreen 保存失败回读（ui/B-3）', () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockSaveEngineKey.mockReset().mockResolvedValue(undefined);
    mockClearEngineKey.mockReset().mockResolvedValue(undefined);
    mockSetSearxngBaseUrl.mockReset().mockResolvedValue(undefined);
    mockSetDefaultEngine.mockReset().mockResolvedValue(undefined);
    // bocha 的 configured 跟随 saveEngineKey 调用次数：key 提交后即视为已落库。
    mockReadConfig.mockReset().mockImplementation(async () => ({
      defaultEngine: null,
      searxngBaseUrl: '',
      engines: {
        bocha: {configured: mockSaveEngineKey.mock.calls.length > 0},
        tavily: {configured: false},
        brave: {configured: false},
        searxng: {configured: false},
      },
    }));
  });

  it('B-3: 部分提交失败后回读，已生效 key 的状态标签立即变 set', async () => {
    mockSetSearxngBaseUrl.mockRejectedValueOnce(new Error('盘炸了'));
    const {renderer} = await renderScreen();
    // 初始四个引擎全部未配置。
    expect(json(renderer)).toContain('tag:not set');

    await typeKey(renderer.root, 0, 'sk-bocha-1');
    await tapSave(renderer.root);

    // bocha key 已提交生效而 baseUrl 写入失败：toast 失败 + 回读后 bocha
    // 标签为 set（不再停留旧状态直到手动重进页面）。
    expect(mockSaveEngineKey).toHaveBeenCalledWith('bocha', 'sk-bocha-1');
    expect(mockShowToast).toHaveBeenCalledWith('保存失败：盘炸了');
    expect(json(renderer)).toContain('tag:set');
  });

  it('保存全部成功：toast 成功且标签同步为 set（成功路径回归）', async () => {
    const {renderer} = await renderScreen();
    await typeKey(renderer.root, 0, 'sk-bocha-1');
    await tapSave(renderer.root);

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('配置已保存');
    expect(json(renderer)).toContain('tag:set');
  });
});
