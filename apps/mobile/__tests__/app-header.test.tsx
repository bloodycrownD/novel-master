import React, {useEffect} from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {AppHeader} from '@/components/chrome/AppHeader';
import {
  HeaderProvider,
  useHeaderContext,
  useStackOverrideSetter,
} from '@/navigation/HeaderContext';
import type {HeaderOverride} from '@/navigation/HeaderContext';
import type {ChatTabNavigationContextValue} from '@/navigation/ChatTabNavContext';

const mockNavState = {
  chatSubview: 'list' as 'list' | 'conversation',
  sessionListPanel: 'sessions' as 'sessions' | 'projects',
  projectName: undefined as string | undefined,
  sessionTitle: undefined as string | undefined,
  sessionDrawerOpen: false,
  projectDrawerOpen: false,
  sessionBatchActive: false,
  workspaceCanGoUp: false,
};

const mockChatNav: ChatTabNavigationContextValue = {
  state: mockNavState,
  actions: {
    backFromConversation: jest.fn(),
    showChatPanel: jest.fn(),
    closeSessionDrawer: jest.fn(),
    closeProjectDrawer: jest.fn(),
    showSessionsPanel: jest.fn(),
    openDrawer: jest.fn(),
    closeMessageMenu: jest.fn(),
    closeMessageEdit: jest.fn(),
    closeModelPicker: jest.fn(),
    closeAgentPicker: jest.fn(),
    closeSessionRename: jest.fn(),
    exitSessionBatch: jest.fn(),
    workspaceGoUp: undefined,
  },
};

// useStackOverrideSetter 经 useRoute 读取当前屏 route key（G-1 断言数据源）。
let mockRouteKey = 'route-A';

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({key: mockRouteKey}),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      headerBackground: '#fff',
      border: '#eee',
      text: '#111',
      primary: '#007',
    },
    mode: 'light',
    toggleMode: jest.fn(),
  }),
}));

jest.mock('@/navigation/ChatTabNavContext', () => ({
  useChatTabNavigationOptional: () => mockChatNav,
}));

jest.mock('@/components/icons/TabIcons', () => {
  const mockReact = require('react');
  const Icon = () => mockReact.createElement('Icon');
  return {
    BackIcon: Icon,
    MenuIcon: Icon,
    MoonIcon: Icon,
    SunIcon: Icon,
  };
});

function headerTitle(root: TestRenderer.ReactTestInstance): string {
  const texts = root.findAll(node => node.type === 'Text');
  const title = texts.find(node => node.props.accessibilityRole === 'header');
  return String(title?.props.children ?? '');
}

/** 非 chat 页的菜单按钮（「?」帮助/☰）是否渲染：label 会传播多层，按存在性判定
 *  （RN 0.85 的 Pressable 不在实例 props 上外露 onPress，不能按可按压层过滤）。 */
function menuButtonPresent(root: TestRenderer.ReactTestInstance): boolean {
  return root.findAllByProps({accessibilityLabel: '项目列表'}).length > 0;
}

/** 测试侧安装 override 的探针：直接调真实 context 的 setStackOverride。 */
function OverrideSetter({override}: {override: HeaderOverride | undefined}) {
  const {setStackOverride} = useHeaderContext();
  useEffect(() => {
    setStackOverride(override);
  }, [setStackOverride, override]);
  return null;
}

function renderHeader({
  pageKey,
  ownerRouteKey,
  override,
}: {
  pageKey: 'chat' | 'SmartSortRuleEditor';
  ownerRouteKey?: string;
  override?: HeaderOverride;
}) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <HeaderProvider>
        <OverrideSetter override={override} />
        <AppHeader pageKey={pageKey} ownerRouteKey={ownerRouteKey} />
      </HeaderProvider>,
    );
  });
  return tree!;
}

describe('AppHeader', () => {
  beforeEach(() => {
    mockNavState.chatSubview = 'list';
    mockNavState.sessionListPanel = 'sessions';
    mockNavState.projectName = undefined;
    mockNavState.sessionTitle = undefined;
    mockRouteKey = 'route-A';
  });

  it('会话列表态显示当前项目名称', () => {
    mockNavState.projectName = '我的小说';
    const tree = renderHeader({pageKey: 'chat'});
    expect(headerTitle(tree.root)).toBe('我的小说');
  });

  it('会话列表态无项目时回退为「会话」', () => {
    const tree = renderHeader({pageKey: 'chat'});
    expect(headerTitle(tree.root)).toBe('会话');
  });

  it('项目工作区分段仍显示固定标题', () => {
    mockNavState.sessionListPanel = 'projects';
    const tree = renderHeader({pageKey: 'chat'});
    expect(headerTitle(tree.root)).toBe('项目工作区');
  });

  it('对话态仍显示会话标题', () => {
    mockNavState.chatSubview = 'conversation';
    mockNavState.sessionTitle = '第一章讨论';
    const tree = renderHeader({pageKey: 'chat'});
    expect(headerTitle(tree.root)).toBe('第一章讨论');
  });

  describe('ownerRouteKey 归属过滤（core/mobile-G-1）', () => {
    it('override 的 owner 匹配当前屏 route key 时应用（标题与「?」按钮）', () => {
      const tree = renderHeader({
        pageKey: 'SmartSortRuleEditor',
        ownerRouteKey: 'route-A',
        override: {
          title: '编辑：章节规则',
          showMenu: true,
          ownerRouteKey: 'route-A',
        },
      });
      expect(headerTitle(tree.root)).toBe('编辑：章节规则');
      expect(menuButtonPresent(tree.root)).toBe(true);
    });

    it('override 的 owner 不匹配当前屏时回退 base 标题且不渲染菜单按钮', () => {
      const tree = renderHeader({
        pageKey: 'SmartSortRuleEditor',
        ownerRouteKey: 'route-A',
        // 转场期间相邻屏（route-B 设置的 override）不该泄漏到本屏 header。
        override: {
          title: '编辑：章节规则',
          showMenu: true,
          ownerRouteKey: 'route-B',
        },
      });
      expect(headerTitle(tree.root)).toBe('规则详情');
      expect(menuButtonPresent(tree.root)).toBe(false);
    });

    it('override 无 ownerRouteKey 时维持旧全局兼容语义（照常应用）', () => {
      const tree = renderHeader({
        pageKey: 'SmartSortRuleEditor',
        ownerRouteKey: 'route-A',
        override: {title: '编辑：章节规则'},
      });
      expect(headerTitle(tree.root)).toBe('编辑：章节规则');
    });
  });

  describe('useStackOverrideSetter 附加 ownerRouteKey（core/mobile-G-1）', () => {
    let latestOverride: HeaderOverride | undefined;

    function SetterProbe({value}: {value: HeaderOverride | undefined}) {
      const setOverride = useStackOverrideSetter();
      const {stackOverride} = useHeaderContext();
      useEffect(() => {
        setOverride(value);
      }, [setOverride, value]);
      latestOverride = stackOverride;
      return null;
    }

    it('setter 自动把当前屏 route key 附加为 ownerRouteKey，清空时不带 owner', () => {
      let tree!: TestRenderer.ReactTestRenderer;
      act(() => {
        tree = TestRenderer.create(
          <HeaderProvider>
            <SetterProbe value={{title: '编辑规则', showMenu: true}} />
          </HeaderProvider>,
        );
      });
      expect(latestOverride).toEqual({
        title: '编辑规则',
        showMenu: true,
        ownerRouteKey: 'route-A',
      });

      // 转场到另一屏（route key 变化）后再次设置：owner 跟随新的 route key。
      mockRouteKey = 'route-B';
      act(() => {
        tree.update(
          <HeaderProvider>
            <SetterProbe value={{title: '编辑规则2'}} />
          </HeaderProvider>,
        );
      });
      expect(latestOverride).toEqual({
        title: '编辑规则2',
        ownerRouteKey: 'route-B',
      });

      // 卸载路径的清空调用：直接置 undefined（不带 owner 残留）。
      act(() => {
        tree.update(
          <HeaderProvider>
            <SetterProbe value={undefined} />
          </HeaderProvider>,
        );
      });
      expect(latestOverride).toBeUndefined();
    });
  });
});
