/**
 * SearchEngineDetailScreen 保存语义（web-search-curl T-U3/T-U4，动态清单版）：
 * 详情页经 `getSearchConfigStore(runtime)` 直接消费 core store 方法，本套件
 * 锁 key 分支的既有语义（与 desktop 同口径）：
 *
 * - 标题 override 用配置读模型里的引擎名；
 * - 保存失败 toast 后立即回读（catch 内补 `await load()`），状态标签反映已生效
 *   configured；
 * - 保存成功 toast 且标签同步 set；
 * - 需 key 的预置引擎留空保存：拦截提示，不触碰密钥库、不回读。
 *
 * 照 search-engines-screen-reorder.test.tsx 的 TestRenderer 直测风格：输入框 /
 * 保存按钮 / 状态标签 mock 成带标记的可交互节点，树文本断言；store mock 扩到
 * core `SearchConfigStore` 全方法（本套件只驱动 key 分支）。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import type {SearchConfigPublic} from '@novel-master/core';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#f8f8f8',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ccc',
      borderLight: '#ddd',
      primary: '#007aff',
      danger: '#f00',
      success: '#0a0',
    },
  }),
}));

const mockShowToast = jest.fn();
const mockGoBack = jest.fn();
const mockSetStackOverride = jest.fn();

// 路由参数：bocha（需 key 的预置引擎表单分支）。
jest.mock('@react-navigation/native', () => {
  const mockReact = require('react');
  return {
    // 依赖数组跟随回调身份：标题变化后重设 override，对齐 focus 语义。
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockReact.useEffect(cb, [cb]);
    },
    useRoute: () => ({params: {engineId: 'bocha'}}),
    useNavigation: () => ({goBack: mockGoBack}),
  };
});

jest.mock('@/navigation/HeaderContext', () => ({
  useStackOverrideSetter: () => mockSetStackOverride,
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

// 状态标签：输出状态文本，断言回读后 set / not set 翻转。
jest.mock('@/components/provider/ApiKeyStatusTag', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    ApiKeyStatusTag: (props: {status: 'set' | 'not set'}) =>
      mockReact.createElement(Text, {tag: props.status}, `tag:${props.status}`),
  };
});

// 弹窗骨架：visible 时才渲染 children（详情页删除确认默认关闭，无需真实 Modal）。
jest.mock('@/components/ui/ModalShell', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    ModalShell: (props: {visible: boolean; children?: React.ReactNode}) =>
      props.visible
        ? mockReact.createElement(Text, null, props.children ?? null)
        : null,
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
  PrimaryButton: () => null,
  SecondaryButton: () => null,
}));

// 输入框：onChangeText 挂到 props 上供测试直接触发；key 输入
// （secureTextEntry）标记可辨。
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

// searchConfig store（core `SearchConfigStore` 形状）：readConfig 的 bocha
// hasKey 随 saveEngineKey 调用次数动态变化，模拟「key 已落库生效」状态；
// 其余写方法只需存在（本套件不驱动）。
const mockReadConfig = jest.fn();
const mockSaveEngineKey = jest.fn();
const mockClearEngineKey = jest.fn();

const mockRuntime = {
  searchConfig: {
    readConfig: (...args: unknown[]) => mockReadConfig(...args),
    saveEngineKey: (...args: unknown[]) => mockSaveEngineKey(...args),
    clearEngineKey: (...args: unknown[]) => mockClearEngineKey(...args),
    setEnabled: jest.fn(),
    setEngineOrder: jest.fn(),
    setEngineBaseUrl: jest.fn(),
    createCustomEngine: jest.fn(),
    updateCustomEngine: jest.fn(),
    deleteCustomEngine: jest.fn(),
    updatePresetOverride: jest.fn(),
    resetPresetOverride: jest.fn(),
    testEngine: jest.fn(),
  },
};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

import {SearchEngineDetailScreen} from '@/screens/stack/SearchEngineDetailScreen';
// 被替换后的 mock 组件引用：用 findAllByType 精确定位（RN 宿主组件会把
// 自定义 props 复制到内部嵌套节点，按 props findAll 会重复匹配）。
import {FormTextInput} from '@/components/form/FormTextInput';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';

/** 动态读模型 fixture：bocha 的 hasKey 跟随 saveEngineKey 调用次数。 */
function makeConfig(): SearchConfigPublic {
  return {
    engines: [
      {
        id: 'bocha',
        name: '博查搜索',
        enabled: true,
        needsKey: true,
        hasKey: mockSaveEngineKey.mock.calls.length > 0,
        needsBaseUrl: false,
        isCustom: false,
        paramHint: '博查参数',
      },
    ],
    customEngines: [],
    presetOverrides: {},
    canRun: [],
  };
}

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

/** 取 key 输入框（bocha 详情表单仅一个 secureTextEntry 输入框）。 */
function keyInput(root: TestRenderer.ReactTestInstance) {
  const nodes = root
    .findAllByType(FormTextInput)
    .filter(n => n.props.secureTextEntry);
  expect(nodes.length).toBe(1);
  return nodes[0];
}

function saveFooter(root: TestRenderer.ReactTestInstance) {
  return root.findByType(StickyFormFooter);
}

async function renderScreen() {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<SearchEngineDetailScreen />);
    // 首轮 load（readConfig → setConfig/setDraft）的 promise 链落定。
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
  return {renderer: renderer!};
}

/** 输入 draft（单独 act flush 重渲染，保证 handleSave 闭包捕获新 draft）。 */
async function typeKey(root: TestRenderer.ReactTestInstance, text: string) {
  await act(async () => {
    keyInput(root).props.onChangeText(text);
  });
}

/** 点保存并 flush 整条 async 链（含 catch 内回读的 load）。 */
async function tapSave(root: TestRenderer.ReactTestInstance) {
  await act(async () => {
    saveFooter(root).props.onPress();
    // saveEngineKey →（catch）load 内 readConfig 的 promise 链逐级
    // await，多轮 microtask 全部落定。
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

describe('SearchEngineDetailScreen 保存语义（web-search-curl 动态清单）', () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockGoBack.mockReset();
    mockSetStackOverride.mockReset();
    mockSaveEngineKey.mockReset().mockResolvedValue(undefined);
    mockClearEngineKey.mockReset().mockResolvedValue(undefined);
    mockReadConfig.mockReset().mockImplementation(async () => makeConfig());
  });

  it('详情页标题 override 用配置读模型里的引擎名', async () => {
    await renderScreen();
    expect(mockSetStackOverride).toHaveBeenCalledWith({title: 'Bocha'});
  });

  it('保存失败后回读，toast 失败且 readConfig 被再次调用', async () => {
    mockSaveEngineKey.mockRejectedValueOnce(new Error('盘炸了'));
    const {renderer} = await renderScreen();
    expect(treeText(renderer.root)).toContain('tag:not set');
    const readsBefore = mockReadConfig.mock.calls.length;

    await typeKey(renderer.root, 'sk-bocha-1');
    await tapSave(renderer.root);

    // toast 失败 + catch 内回读（状态标签刷新链路被触发）。
    expect(mockSaveEngineKey).toHaveBeenCalledWith('bocha', 'sk-bocha-1');
    expect(mockShowToast).toHaveBeenCalledWith('保存失败：盘炸了');
    expect(mockReadConfig.mock.calls.length).toBeGreaterThan(readsBefore);
  });

  it('保存成功：toast 成功且标签同步为 set（成功路径回归）', async () => {
    const {renderer} = await renderScreen();
    await typeKey(renderer.root, 'sk-bocha-1');
    await tapSave(renderer.root);

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('配置已保存');
    expect(treeText(renderer.root)).toContain('tag:set');
  });

  it('留空保存：拦截并提示，不触碰密钥库、不回读', async () => {
    const {renderer} = await renderScreen();
    const readsBefore = mockReadConfig.mock.calls.length;
    await tapSave(renderer.root);

    expect(mockSaveEngineKey).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      '请输入 API Key（留空不会修改已保存的密钥）',
    );
    // 拦截早退：无成功链路的回读（readConfig 调用数不变）。
    expect(mockReadConfig.mock.calls.length).toBe(readsBefore);
  });
});
