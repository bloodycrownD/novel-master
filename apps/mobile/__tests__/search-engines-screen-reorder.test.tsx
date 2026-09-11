/**
 * SearchEnginesScreen 列表屏（修订轮两级）：engineOrder 顺序渲染 +
 * 行菜单上移/下移（首位上移/末位下移禁用，照 ProvidersScreen 的
 * BottomSheetMenu 禁用先例）+ 排序写库后重读刷新。
 *
 * 照 providers-screen-error.test.tsx 的 TestRenderer 直测风格：
 * 行卡片 / 菜单 mock 成带标记的可交互节点，树文本与调用参数断言。
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

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const mockReact = require('react');
  return {
    // 挂载时执行一次，对齐真实 focus 语义（每渲染都跑会触发 reload 无限循环）。
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockReact.useEffect(cb, []);
    },
    useNavigation: () => ({navigate: mockNavigate}),
  };
});

// 状态标签：输出状态文本，断言 configured 翻转。
jest.mock('@/components/provider/ApiKeyStatusTag', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    ApiKeyStatusTag: (props: {status: 'set' | 'not set'}) =>
      mockReact.createElement(Text, {tag: props.status}, `tag:${props.status}`),
  };
});

// 行卡片：标题文本 + 行点击 / 菜单按钮挂到 props 上供测试直接触发；
// testMenu 标记行所属引擎，供菜单按钮定位；trailingMeta（状态标签）
// 透传进树。
jest.mock('@/components/ui/ConfigListCard', () => {
  const mockReact = require('react');
  const {Pressable, Text} = require('react-native');
  return {
    ConfigListCard: (props: {
      title: string;
      onPress: () => void;
      onMenuPress?: () => void;
      trailingMeta?: React.ReactNode;
    }) =>
      mockReact.createElement(
        Pressable,
        {onPress: props.onPress, title: props.title},
        mockReact.createElement(Text, null, props.title),
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

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

const mockShowToast = jest.fn();

// 顶栏 override：记录调用参数，供标题栏「?」帮助按钮断言。
jest.mock('@/navigation/HeaderContext', () => ({
  useHeaderContext: () => ({setStackOverride: mockSetStackOverride}),
}));

const mockSetStackOverride = jest.fn();

// 帮助弹窗骨架：visible 时输出标记节点，供断言开关状态。
jest.mock('@/components/ui/ModalShell', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    ModalShell: (props: {visible: boolean; onClose: () => void}) =>
      props.visible
        ? mockReact.createElement(
            Text,
            {testHelpModal: 'help', onClose: props.onClose},
            '使用说明',
          )
        : null,
  };
});

// searchConfig store mock：readConfig 返回固定 engineOrder + configured；
// setEngineOrder 记录调用参数。
const mockReadConfig = jest.fn();
const mockSetEngineOrder = jest.fn();

const mockRuntime = {
  searchConfig: {
    readConfig: (...args: unknown[]) => mockReadConfig(...args),
    setEngineOrder: (...args: unknown[]) => mockSetEngineOrder(...args),
  },
};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

import {SearchEnginesScreen} from '@/screens/stack/SearchEnginesScreen';

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

/** 打开指定引擎的行菜单（点行卡片菜单按钮）。 */
async function openMenu(
  root: TestRenderer.ReactTestInstance,
  engineLabel: string,
) {
  const menuBtn = root.findAll(node => node.props.testMenu === engineLabel)[0];
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

async function renderScreen() {
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<SearchEnginesScreen />);
  });
  return {renderer: renderer!};
}

describe('SearchEnginesScreen 列表屏（修订轮两级）', () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockNavigate.mockReset();
    mockSetStackOverride.mockReset();
    mockSetEngineOrder.mockReset().mockResolvedValue(undefined);
    mockReadConfig.mockReset().mockImplementation(async () => ({
      engineOrder: ['bocha', 'tavily', 'brave', 'searxng'],
      searxngBaseUrl: '',
      engines: {
        bocha: {configured: false},
        tavily: {configured: true},
        brave: {configured: false},
        searxng: {configured: false},
      },
    }));
  });

  it('按 engineOrder 顺序渲染四引擎行 + configured 状态标签', async () => {
    mockReadConfig.mockImplementation(async () => ({
      engineOrder: ['tavily', 'searxng', 'bocha', 'brave'],
      searxngBaseUrl: '',
      engines: {
        bocha: {configured: false},
        tavily: {configured: true},
        brave: {configured: false},
        searxng: {configured: false},
      },
    }));
    const {renderer} = await renderScreen();
    const text = treeText(renderer.root);

    // 顺序断言：tavily 在 bocha 前、searxng 在 brave 前。
    expect(text.indexOf('Tavily')).toBeLessThan(text.indexOf('Bocha'));
    expect(text.indexOf('SearXNG')).toBeLessThan(text.indexOf('Brave'));
    // 状态标签跟随 configured。
    expect(text).toContain('tag:set');
    expect(text).toContain('tag:not set');
  });

  it('点击行 navigate 详情页（携带 engineId）', async () => {
    const {renderer} = await renderScreen();
    const row = renderer.root.findAll(node => node.props.title === 'Bocha')[0];
    await act(async () => {
      row.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('SearchEngineDetail', {
      engineId: 'bocha',
    });
  });

  it('行菜单上移：交换相邻位后 setEngineOrder 整单写库并重读', async () => {
    const {renderer} = await renderScreen();
    const readsBefore = mockReadConfig.mock.calls.length;

    await openMenu(renderer.root, 'Tavily');
    await act(async () => {
      renderer.root
        .findAll(node => node.props.onSelect != null)[0]
        .props.onSelect('up');
      // setEngineOrder → reload 内 readConfig 的 promise 链逐级落定。
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    });

    // tavily(下标1) 与 bocha(下标0) 交换。
    expect(mockSetEngineOrder).toHaveBeenCalledTimes(1);
    expect(mockSetEngineOrder).toHaveBeenCalledWith([
      'tavily',
      'bocha',
      'brave',
      'searxng',
    ]);
    // 上移后重读刷新（初始挂载一次 + 排序后一次）。
    expect(mockReadConfig.mock.calls.length).toBe(readsBefore + 1);
  });

  it('行菜单下移：末位与前一交换；首位上移/末位下移禁用', async () => {
    const {renderer} = await renderScreen();

    // 首位 bocha：上移禁用、下移可用。
    await openMenu(renderer.root, 'Bocha');
    expect(menuItemDisabled(renderer.root, 'up')).toBe(true);
    expect(menuItemDisabled(renderer.root, 'down')).toBe(false);

    // 末位 searxng：下移禁用。
    await openMenu(renderer.root, 'SearXNG');
    expect(menuItemDisabled(renderer.root, 'down')).toBe(true);

    // brave(下标2) 下移 → 与 searxng 交换。
    await openMenu(renderer.root, 'Brave');
    await act(async () => {
      renderer.root
        .findAll(node => node.props.onSelect != null)[0]
        .props.onSelect('down');
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    });
    expect(mockSetEngineOrder).toHaveBeenCalledWith([
      'bocha',
      'tavily',
      'searxng',
      'brave',
    ]);
  });

  it('标题栏「?」帮助按钮：override 菜单位并打开使用说明弹窗', async () => {
    const {renderer} = await renderScreen();
    expect(mockSetStackOverride).toHaveBeenCalled();
    const override = mockSetStackOverride.mock.calls[0][0];
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

    await openMenu(renderer.root, 'Tavily');
    await act(async () => {
      renderer.root
        .findAll(node => node.props.onSelect != null)[0]
        .props.onSelect('up');
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    });

    expect(mockShowToast).toHaveBeenCalledWith('调整顺序失败：盘炸了');
  });
});
