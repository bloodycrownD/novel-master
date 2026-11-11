/**
 * SearchEnginesScreen 列表屏（web-search-curl T-U3/T-U4）：行清单完全来自
 * `readConfig().engines`（core 动态全集：预置 + 自定义实例 + DDG，顺序即
 * engineOrderV2），本套件锁动态 fixture 下的：
 *
 * - 顺序渲染与状态标签（开关 / 密钥 / 实例地址三类提示，DDG 走「内置」徽标）；
 * - 行内开关 setEnabled（id 原样透传，与排序解耦）；
 * - 行菜单上移 / 下移：交换相邻位后整单 setEngineOrder 写库并重读，动态 id
 *   （含 `custom:` 实例）不丢；
 * - 保留项：行点击导航（DDG / 预置）、标题栏「?」帮助弹窗、排序写库失败 toast。
 *
 * 照 providers-screen-error.test.tsx 的 TestRenderer 直测风格：行卡片 / 菜单
 * mock 成带标记的可交互节点，树文本与调用参数断言；store 经
 * `getSearchConfigStore(runtime)` 取 runtime 上的装配实例，mock 同一入口。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Switch} from 'react-native';
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

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const mockReact = require('react');
  return {
    // 依赖数组跟随回调身份：标题 / fetcher 变化时重跑，对齐 focus 语义
    // （忽略依赖会拿初始闭包，标题永远停在加载态文案）。
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockReact.useEffect(cb, [cb]);
    },
    useNavigation: () => ({navigate: mockNavigate}),
  };
});

// 状态标签：输出状态文本，断言 hasKey / baseUrl 翻转。
jest.mock('@/components/provider/ApiKeyStatusTag', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    ApiKeyStatusTag: (props: {status: 'set' | 'not set'}) =>
      mockReact.createElement(Text, {tag: props.status}, `tag:${props.status}`),
  };
});

// 行卡片：rowTitle 标记行（只挂在宿主节点上，findAll 不重复命中复合节点）；
// 标题 / 副标题 / trailingMeta 透传进树，onPress 供导航断言、onMenuPress
// 供菜单按钮定位。
jest.mock('@/components/ui/ConfigListCard', () => {
  const mockReact = require('react');
  const {Pressable, Text} = require('react-native');
  return {
    ConfigListCard: (props: {
      title: string;
      subtitle?: string;
      onPress: () => void;
      onMenuPress?: () => void;
      trailingMeta?: React.ReactNode;
    }) =>
      mockReact.createElement(
        Pressable,
        {rowTitle: props.title, onPress: props.onPress},
        mockReact.createElement(Text, null, props.title),
        props.subtitle != null
          ? mockReact.createElement(Text, null, props.subtitle)
          : null,
        props.trailingMeta ?? null,
        props.onMenuPress != null
          ? mockReact.createElement(
              Pressable,
              {onPress: props.onMenuPress, testMenu: props.title},
              mockReact.createElement(Text, null, `menu:${props.title}`),
            )
          : null,
      ),
  };
});

// 行菜单：visible 时输出各项 label 与禁用态标记，onSelect 挂 props。
jest.mock('@/components/sheet/BottomSheetMenu', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    BottomSheetMenu: (props: {
      visible: boolean;
      items: Array<{label: string; action: string; disabled?: boolean}>;
      onSelect: (action: string) => void;
    }) =>
      props.visible
        ? mockReact.createElement(
            Text,
            {onSelect: props.onSelect},
            ...props.items.map(item =>
              mockReact.createElement(
                Text,
                {key: item.action, tag: item.action, disabled: item.disabled},
                `${item.label}:${item.disabled ? '禁用' : '可用'}`,
              ),
            ),
          )
        : null,
  };
});

jest.mock('@/hooks/useDismissOverlaysOnBlur', () => ({
  useDismissOverlaysOnBlur: (_dismiss: () => void) => undefined,
}));

const mockShowToast = jest.fn();

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

const mockSetStackOverride = jest.fn();

// 顶栏 override：记录调用参数，供标题栏「?」帮助按钮断言。
jest.mock('@/navigation/HeaderContext', () => ({
  useStackOverrideSetter: () => mockSetStackOverride,
}));

// 帮助 / 删除确认弹窗骨架：visible 时输出标记节点，供断言开关状态。
jest.mock('@/components/ui/ModalShell', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    ModalShell: (props: {visible: boolean; children?: React.ReactNode}) =>
      props.visible
        ? mockReact.createElement(
            Text,
            {testModalShell: 'open'},
            props.children ?? null,
          )
        : null,
  };
});

// searchConfig store：UI 经 getSearchConfigStore(runtime) 直接取 runtime 上的
// 装配实例（core createSearchConfigStore 形状），本套件只替换该实例。
const mockReadConfig = jest.fn();
const mockSetEnabled = jest.fn();
const mockSetEngineOrder = jest.fn();
const mockDeleteCustomEngine = jest.fn();

const mockRuntime = {
  searchConfig: {
    readConfig: (...args: unknown[]) => mockReadConfig(...args),
    setEnabled: (...args: unknown[]) => mockSetEnabled(...args),
    setEngineOrder: (...args: unknown[]) => mockSetEngineOrder(...args),
    deleteCustomEngine: (...args: unknown[]) => mockDeleteCustomEngine(...args),
  },
};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

import {SearchEnginesScreen} from '@/screens/stack/SearchEnginesScreen';

const CUSTOM_ID = 'custom:abc12345';

/** 动态读模型 fixture：预置 + 自定义 + DDG 混排，覆盖三类状态提示。 */
function makeConfig(): SearchConfigPublic {
  return {
    engines: [
      {
        id: 'bocha',
        name: '博查搜索',
        enabled: true,
        needsKey: true,
        hasKey: true,
        needsBaseUrl: false,
        isCustom: false,
        paramHint: '博查参数',
      },
      {
        id: CUSTOM_ID,
        name: '我的搜索',
        enabled: false,
        needsKey: true,
        hasKey: false,
        needsBaseUrl: false,
        isCustom: true,
        paramHint: '自定义参数',
      },
      {
        id: 'duckduckgo',
        name: 'DuckDuckGo',
        enabled: true,
        needsKey: false,
        hasKey: false,
        needsBaseUrl: false,
        isCustom: false,
        paramHint: '',
      },
      {
        id: 'searxng',
        name: 'SearXNG',
        enabled: false,
        needsKey: false,
        hasKey: false,
        needsBaseUrl: true,
        isCustom: false,
        paramHint: '',
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        enabled: true,
        needsKey: true,
        hasKey: false,
        needsBaseUrl: false,
        isCustom: false,
        paramHint: 'deepseek 参数',
      },
    ],
    customEngines: [
      {
        id: CUSTOM_ID,
        name: '我的搜索',
        createdAt: '2026-11-01T00:00:00.000Z',
        template: {
          name: '我的搜索',
          method: 'POST',
          url: 'https://api.example.com/search',
          headers: {Authorization: 'Bearer {{apiKey}}'},
          bodyTemplate: '{"query":"{{query}}"}',
          resultPath: 'results',
          fieldMap: {title: ['title'], url: ['url'], snippet: ['snippet']},
          paramHint: '自定义参数',
        },
      },
    ],
    presetOverrides: {},
    canRun: ['bocha', 'duckduckgo'],
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

/** 行节点（rowTitle 只挂在 ConfigListCard mock 的宿主节点上）。 */
function rowsOf(
  root: TestRenderer.ReactTestInstance,
): TestRenderer.ReactTestInstance[] {
  return root.findAll(node => node.props.rowTitle != null);
}

function rowByTitle(
  root: TestRenderer.ReactTestInstance,
  title: string,
): TestRenderer.ReactTestInstance {
  const row = rowsOf(root).find(node => node.props.rowTitle === title);
  expect(row).toBeDefined();
  return row!;
}

/** 行标题序列（Pressable 会给宿主节点重复带同 props，按相邻去重）。 */
function rowTitles(root: TestRenderer.ReactTestInstance): string[] {
  const titles: string[] = [];
  for (const node of rowsOf(root)) {
    const title = node.props.rowTitle as string;
    if (titles.at(-1) !== title) {
      titles.push(title);
    }
  }
  return titles;
}

/** 打开指定引擎的行菜单（点行卡片菜单按钮）。 */
async function openMenu(
  root: TestRenderer.ReactTestInstance,
  title: string,
): Promise<void> {
  const menuBtn = root.findAll(node => node.props.testMenu === title)[0];
  expect(menuBtn).toBeDefined();
  await act(async () => {
    menuBtn.props.onPress();
  });
}

/** 断言当前打开菜单里某 action 项的禁用态。 */
function menuItemDisabled(
  root: TestRenderer.ReactTestInstance,
  action: string,
): boolean {
  const item = root.findAll(node => node.props.tag === action)[0];
  expect(item).toBeDefined();
  return item.props.disabled === true;
}

/** 触发当前菜单的 action（菜单 mock 的 onSelect 挂在树节点上）。 */
async function selectMenuAction(
  root: TestRenderer.ReactTestInstance,
  action: string,
): Promise<void> {
  await act(async () => {
    root.findAll(node => node.props.onSelect != null)[0].props.onSelect(action);
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function renderScreen() {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<SearchEnginesScreen />);
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
  return {renderer: renderer!};
}

describe('SearchEnginesScreen 列表屏（web-search-curl 动态清单）', () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockNavigate.mockReset();
    mockSetStackOverride.mockReset();
    mockReadConfig.mockReset().mockImplementation(async () => makeConfig());
    mockSetEnabled.mockReset().mockResolvedValue(undefined);
    mockSetEngineOrder.mockReset().mockResolvedValue(undefined);
    mockDeleteCustomEngine.mockReset().mockResolvedValue(undefined);
  });

  it('按 readConfig().engines 顺序动态渲染预置 / 自定义 / DDG 行', async () => {
    const {renderer} = await renderScreen();
    expect(rowTitles(renderer.root)).toEqual([
      'Bocha',
      '我的搜索',
      'DuckDuckGo',
      'SearXNG',
      'DeepSeek',
    ]);
    // 顺序跟随 fixture，不按静态出厂表重排。
    const text = treeText(renderer.root);
    expect(text.indexOf('Bocha')).toBeLessThan(text.indexOf('我的搜索'));
    expect(text.indexOf('我的搜索')).toBeLessThan(text.indexOf('DuckDuckGo'));
    expect(text.indexOf('DuckDuckGo')).toBeLessThan(text.indexOf('SearXNG'));
  });

  it('状态标签：hasKey / baseUrl / enabled 三类提示按引擎实时状态渲染', async () => {
    const {renderer} = await renderScreen();

    // 预置且已存 key：set 标签，无缺失提示。
    const bocha = treeText(rowByTitle(renderer.root, 'Bocha'));
    expect(bocha).toContain('tag:set');
    expect(bocha).not.toContain('未配置密钥');
    expect(bocha).not.toContain('已关闭');

    // 自定义实例关闭且无 key：not set + 关闭 + 未配置密钥。
    const custom = treeText(rowByTitle(renderer.root, '我的搜索'));
    expect(custom).toContain('tag:not set');
    expect(custom).toContain('自定义模板');
    expect(custom).toContain('已关闭');
    expect(custom).toContain('未配置密钥');

    // searxng 需实例地址且未配置：not set + 未配置实例地址。
    const searxng = treeText(rowByTitle(renderer.root, 'SearXNG'));
    expect(searxng).toContain('tag:not set');
    expect(searxng).toContain('未配置实例地址');

    // 预置需 key 未配置 + 开关开启：只有「未配置密钥」，无「已关闭」。
    const deepseek = treeText(rowByTitle(renderer.root, 'DeepSeek'));
    expect(deepseek).toContain('tag:not set');
    expect(deepseek).toContain('未配置密钥');
    expect(deepseek).not.toContain('已关闭');

    // DDG 无凭据可配：走「内置」徽标，不是 set/not set 标签。
    const ddg = treeText(rowByTitle(renderer.root, 'DuckDuckGo'));
    expect(ddg).toContain('内置');
    expect(ddg).not.toContain('tag:');
  });

  it('行内开关：setEnabled 收到动态 id，乐观翻转不等重读', async () => {
    const {renderer} = await renderScreen();
    const switches = renderer.root.findAllByType(Switch);
    expect(switches.length).toBe(5);

    await act(async () => {
      switches[1].props.onValueChange(true);
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    });

    expect(mockSetEnabled).toHaveBeenCalledTimes(1);
    expect(mockSetEnabled).toHaveBeenCalledWith(CUSTOM_ID, true);
    expect(renderer.root.findAllByType(Switch)[1].props.value).toBe(true);
  });

  it('行菜单上移：交换相邻位后按动态 id 整单写库并重读', async () => {
    const {renderer} = await renderScreen();
    const readsBefore = mockReadConfig.mock.calls.length;

    await openMenu(renderer.root, '我的搜索');
    await selectMenuAction(renderer.root, 'up');

    expect(mockSetEngineOrder).toHaveBeenCalledTimes(1);
    expect(mockSetEngineOrder).toHaveBeenCalledWith([
      CUSTOM_ID,
      'bocha',
      'duckduckgo',
      'searxng',
      'deepseek',
    ]);
    // 上移后重读刷新（初始挂载一次 + 排序后一次）。
    expect(mockReadConfig.mock.calls.length).toBe(readsBefore + 1);
  });

  it('行菜单下移：末位禁用；中间行下移后顺序含自定义 id', async () => {
    const {renderer} = await renderScreen();

    // 首位上移禁用、下移可用。
    await openMenu(renderer.root, 'Bocha');
    expect(menuItemDisabled(renderer.root, 'up')).toBe(true);
    expect(menuItemDisabled(renderer.root, 'down')).toBe(false);

    // 末位 deepseek：下移禁用。
    await openMenu(renderer.root, 'DeepSeek');
    expect(menuItemDisabled(renderer.root, 'down')).toBe(true);
    expect(menuItemDisabled(renderer.root, 'up')).toBe(false);

    // 自定义实例（下标 1）下移 → 与 DDG 交换。
    await openMenu(renderer.root, '我的搜索');
    await selectMenuAction(renderer.root, 'down');
    expect(mockSetEngineOrder).toHaveBeenCalledWith([
      'bocha',
      'duckduckgo',
      CUSTOM_ID,
      'searxng',
      'deepseek',
    ]);
  });

  it('点击行 navigate 详情页（DDG / 模拟自定义实例均携带动态 id）', async () => {
    const {renderer} = await renderScreen();

    await act(async () => {
      rowByTitle(renderer.root, 'DuckDuckGo').props.onPress();
    });
    expect(mockNavigate).toHaveBeenLastCalledWith('SearchEngineDetail', {
      engineId: 'duckduckgo',
    });

    await act(async () => {
      rowByTitle(renderer.root, '我的搜索').props.onPress();
    });
    expect(mockNavigate).toHaveBeenLastCalledWith('SearchEngineDetail', {
      engineId: CUSTOM_ID,
    });
  });

  it('标题栏「?」帮助按钮：override 菜单打开使用说明弹窗', async () => {
    const {renderer} = await renderScreen();
    expect(mockSetStackOverride).toHaveBeenCalled();
    const override = mockSetStackOverride.mock.calls.at(-1)![0];
    expect(override.title).toBe('搜索配置');
    expect(override.showMenu).toBe(true);
    // 初始弹窗关闭；点「?」后树里出现使用说明文本。
    expect(treeText(renderer.root)).not.toContain('使用说明');
    await act(async () => {
      override.onMenu();
    });
    expect(treeText(renderer.root)).toContain('使用说明');
  });

  it('排序写库失败：toast 报错，不静默吞掉', async () => {
    mockSetEngineOrder.mockRejectedValueOnce(new Error('盘炸了'));
    const {renderer} = await renderScreen();

    await openMenu(renderer.root, '我的搜索');
    await selectMenuAction(renderer.root, 'up');

    expect(mockShowToast).toHaveBeenCalledWith('调整顺序失败：盘炸了');
  });
});
