/**
 * 会话列表面板的**壳**（chat-webview-unify 第二阶段 wave-2 之后）。
 *
 * ## 这个文件为什么还在、测什么
 *
 * 会话列表本体（ManageHeader / FlatList 会话行 / 三徽标 / 「活跃中」meta / 长按进
 * 批量）整体搬进了 `chat-conversation` 文档，判定逻辑的测试跟着搬到 web 侧
 * （`__tests__/chat-conversation-session-list.test.ts` 覆盖徽标与相对时间），
 * 所以原先那组 GWT-6/GWT-7 徽标用例随组件一起退役。
 *
 * 但**壳本身还有真逻辑，不能跟着删**：
 * 1. `ChatSessionListPanel`（切换条）在列表视图独占一行、会话视图整行收起——
 *    收起判据错了，切换条会压在 WebView 列表视图上面，用户点不到列表。
 * 2. `ChatSessionListProjectsPanel`（项目工作区）要盖在常驻 WebView **之上**且
 *    绝对定位铺满内容区；它还得把「可回上级目录」注册进 `WorkspaceBackCtx`，
 *    且**面板不可见时必须注销**——否则 Android 返回键会去操作一个看不见的文件
 *    管理器（聊天工作区那边同名注册会被它顶掉，两处一起坏）。
 *
 * 这两条正是退役后唯一还可能坏的地方，故本文件从「徽标判定」改测「壳的显隐与
 * 返回键注册」，不删文件。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import type {ReactTestInstance} from 'react-test-renderer';
import {Text, View} from 'react-native';

import type {ThemeTokens} from '@/theme/tokens';
import {
  ChatSessionListPanel,
  ChatSessionListProjectsPanel,
} from '@/screens/tabs/chat-tab/ChatSessionListPanel';

// ── WorkspaceBackCtx 注册捕获（两个组件都经它注册/注销）────────────────
const mockRegisterBackState = jest.fn();
const mockVfsHandle = {
  canGoUp: jest.fn(() => false),
  goUp: jest.fn(),
  reload: jest.fn(async () => undefined),
};

/** 项目工作区分支装出来的 VfsFileManager 挂了几个（0 = 未渲染/未激活）。 */
let mockVfsRenderCount = 0;
jest.mock('@/components/vfs/VfsFileManager', () => {
  const mockReact = require('react');
  return {
    VfsFileManager: mockReact.forwardRef(
      (_props: unknown, ref: React.Ref<unknown>) => {
        mockVfsRenderCount += 1;
        mockReact.useImperativeHandle(ref, () => mockVfsHandle);
        return null;
      },
    ),
  };
});

jest.mock('@/screens/tabs/chat-tab/ChatTabNavigationProvider', () => ({
  useChatTabWorkspaceBackState: () => mockRegisterBackState,
}));

// SegmentedControl 内部经 useTheme 取主题：测试环境无 ThemeProvider 挂载，
// 照 vfs-file-manager 测试先例 mock 上下文值。
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      surface: '#111',
      surfaceElevated: '#111',
      border: '#222',
      borderLight: '#222',
      text: '#fff',
      textSecondary: '#ccc',
      textTertiary: '#777',
      primary: '#08f',
      danger: '#f00',
    },
  }),
}));

const tokens = {
  surfaceElevated: '#111',
  borderLight: '#222',
  primary: '#08f',
  text: '#fff',
  textSecondary: '#ccc',
  textTertiary: '#777',
} as unknown as ThemeTokens;

const projectVfs = {} as never;
const projectWorktree = {} as never;

function renderControl(
  overrides: Partial<React.ComponentProps<typeof ChatSessionListPanel>> = {},
): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ChatSessionListPanel
        tokens={tokens}
        visible
        sessionListPanel="sessions"
        onSessionListPanelChange={jest.fn()}
        {...overrides}
      />,
    );
  });
  return tree;
}

function renderProjects(
  overrides: Partial<React.ComponentProps<typeof ChatSessionListProjectsPanel>> =
    {},
): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ChatSessionListProjectsPanel
        tokens={tokens}
        visible
        sessionListPanel="projects"
        projectId="p1"
        vfsRefreshKey={0}
        projectVfs={projectVfs}
        projectWorktree={projectWorktree}
        onOpenFileEditor={jest.fn()}
        {...overrides}
      />,
    );
  });
  return tree;
}

/** RN 样式里 `display:'none'` 的判定（壳的显隐语义全靠它）。 */
function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const flat = (Array.isArray(node.props.style) ? node.props.style : [node.props.style])
    .filter(Boolean)
    .flatMap((item: Record<string, unknown>) =>
      typeof item === 'object' ? Object.keys(item) : [],
    );
  return {display: flat.includes('display') ? 'none' : undefined};
}

describe('ChatSessionListPanel 壳 · 切换条显隐', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('列表视图（visible）下切换条渲染且不隐藏——它是 WebView 列表视图的表头', () => {
    const tree = renderControl();
    const texts = tree.root
      .findAllByType(Text)
      .map(node => String(node.props.children ?? ''));
    expect(texts).toContain('会话');
    expect(texts).toContain('项目工作区');
    expect(styleOf(tree.root.findByType(View))).not.toMatchObject({
      display: 'none',
    });
    act(() => {
      tree.unmount();
    });
  });

  it('会话视图（visible=false）下整行收起——否则切换条会盖住对话视图', () => {
    const tree = renderControl({visible: false});
    expect(styleOf(tree.root.findByType(View))).toMatchObject({display: 'none'});
    act(() => {
      tree.unmount();
    });
  });

  it('**不再**渲染任何会话行内容（列表已搬进 WebView 文档）', () => {
    // 回归点：退役不彻底时最容易留下的痕迹——RN 侧还挂着一份旧 FlatList，
    // 于是同一个列表出现两遍（web 一份 + RN 一份），且两份数据会打架。
    const tree = renderControl();
    const texts = tree.root
      .findAllByType(Text)
      .map(node => String(node.props.children ?? ''));
    expect(texts).not.toContain('新建会话');
    act(() => {
      tree.unmount();
    });
  });
});

describe('ChatSessionListProjectsPanel · 覆盖层与返回键注册', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVfsRenderCount = 0;
    mockVfsHandle.canGoUp.mockReturnValue(false);
  });

  it('projects 态：渲染 VfsFileManager 并注册 WorkspaceBackCtx', () => {
    const tree = renderProjects();
    expect(mockVfsRenderCount).toBeGreaterThan(0);
    expect(mockRegisterBackState).toHaveBeenCalledWith(
      expect.objectContaining({canGoUp: false}),
    );
    act(() => {
      tree.unmount();
    });
  });

  it('sessions 态（切回会话列表）：覆盖层隐藏、文件管理器卸载', () => {
    const tree = renderProjects({sessionListPanel: 'sessions'});
    expect(mockVfsRenderCount).toBe(0);
    act(() => {
      tree.unmount();
    });
  });

  it('不可见时**注销**返回键态（否则返回键去操作看不见的目录树）', () => {
    renderProjects({visible: false});
    expect(mockRegisterBackState).toHaveBeenCalledWith(null);
  });

  it('可回上级时注册 canGoUp=true + goUp 动作', () => {
    mockVfsHandle.canGoUp.mockReturnValue(true);
    const tree = renderProjects();
    const registered = mockRegisterBackState.mock.calls.at(-1)?.[0] as {
      canGoUp: boolean;
      goUp: () => void;
    };
    expect(registered.canGoUp).toBe(true);
    act(() => {
      registered.goUp();
    });
    expect(mockVfsHandle.goUp).toHaveBeenCalled();
    act(() => {
      tree.unmount();
    });
  });

  it('无可用工作区时给占位文案（而不是空白）', () => {
    const tree = renderProjects({projectVfs: null, projectWorktree: null});
    const texts = tree.root
      .findAllByType(Text)
      .map(node => String(node.props.children ?? ''));
    expect(texts).toContain('请先选择项目');
    act(() => {
      tree.unmount();
    });
  });
});
