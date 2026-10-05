/**
 * ChatSessionListPanel 徽标判定测试（Step 9 / GWT-6；2026-09-30 GWT-7 回归）。
 *
 * 状态判定两态：running（activeRunIds 含该会话）→「生成中」徽标；
 * interrupted（interruptedRunIds 含该会话，无论是否当前会话）→「已中断」
 * 徽标；「当前」位置徽标与运行态正交、照常按 isCurrent 出。
 *
 * 「 · 活跃中」meta 的唯一判据是 isRunning（manager 的真实判活），**不是**
 * isCurrent：挂在 isCurrent 上时它退化成「当前会话」标记，run 收尾后与 app
 * 重启后都不消失（GWT-7 原样复现，见下）。
 *
 * 回滚「会话列表进 WebView」后：会话列表本体回到 RN FlatList（本文件从「壳」
 * 形态恢复），故除徽标族外另覆盖批量态 / 行点按 / ⋮ 菜单接线 / projects 分支
 * 挂载 key。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import type {ReactTestInstance} from 'react-test-renderer';
import {Text} from 'react-native';
import type {ChatSession} from '@novel-master/core/chat';

import type {ThemeTokens} from '@/theme/tokens';
import {ChatSessionListPanel} from '@/screens/tabs/chat-tab/ChatSessionListPanel';

// manager 订阅捕获：手动驱动 listener 验证 subscribe 刷新接线
const mockListeners: Array<() => void> = [];
const mockManager = {
  activeSessionIds: jest.fn((): readonly string[] => []),
  interruptedSessionIds: jest.fn((): ReadonlySet<string> => new Set()),
  subscribe: jest.fn((listener: () => void) => {
    mockListeners.push(listener);
    return () => undefined;
  }),
  stopRun: jest.fn(() => true),
};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => ({sessionStreamUnitManager: mockManager}),
}));

// ManageHeader/BatchCheckbox 内部经 useTheme 取主题：测试环境无
// ThemeProvider 挂载，照 vfs-file-manager 测试先例 mock 上下文值。
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

jest.mock('@/screens/tabs/chat-tab/ChatTabNavigationProvider', () => ({
  useChatTabWorkspaceBackState: () => null,
}));

// BottomSheetMenu mock 成哑组件，改从 props 捕获面观测菜单项与 action 分发
type MenuCapture = {
  visible: boolean;
  labels: string[];
  select: (action: string) => void;
};
const menuCalls: MenuCapture[] = [];
jest.mock('@/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: (props: {
    visible: boolean;
    items: Array<{label: string; action: string}>;
    onSelect: (action: string) => void;
  }) => {
    menuCalls.push({
      visible: props.visible,
      labels: props.items.map(item => item.label),
      select: props.onSelect,
    });
    return null;
  },
}));

// VfsFileManager 挂载观测：React 会把 `key` 从 props 里摘走，所以改数
// **挂载次数**——key 含 vfsRefreshKey 时 vfsRefreshKey 一变即整实例重挂
// （mount 计数 +1），key 去掉 vfsRefreshKey 则计数不动。
const mockVfsMountCount = {value: 0};
jest.mock('@/components/vfs/VfsFileManager', () => {
  const mockReact = require('react');
  return {
    VfsFileManager: mockReact.forwardRef(
      (_props: unknown, _ref: React.Ref<unknown>) => {
        mockReact.useEffect(() => {
          mockVfsMountCount.value += 1;
        }, []);
        return null;
      },
    ),
  };
});

const tokens = {
  surfaceElevated: '#111',
  borderLight: '#222',
  primary: '#08f',
  text: '#fff',
  textSecondary: '#ccc',
  textTertiary: '#777',
} as unknown as ThemeTokens;

function makeSession(id: string): ChatSession {
  return {
    id,
    projectId: 'p',
    title: `会话-${id}`,
    parentSessionId: null,
    createdAtMs: 1_000,
    updatedAtMs: Date.now(),
  };
}

/** 全树 Text 的拼接文本（meta 行是 [相对时间, 状态后缀] 数组，拼起来再匹配）。 */
function textContents(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map(node =>
    React.Children.toArray(node.props.children)
      .map(child => (typeof child === 'string' ? child : ''))
      .join(''),
  );
}

function countContaining(contents: string[], needle: string): number {
  return contents.filter(content => content.includes(needle)).length;
}

/** 会话列表本体：FlatList 节点（带 data + renderItem 的那层）。 */
function findSessionList(root: ReactTestInstance): ReactTestInstance | null {
  const hits = root.findAll(
    node =>
      typeof node.props.renderItem === 'function' &&
      node.props.keyExtractor != null,
    {deep: true},
  );
  return hits[hits.length - 1] ?? null;
}

/** 会话行：同时带 onPress + onLongPress 的那层（菜单 ⋮ 只有一个 onPress）。 */
function findSessionRow(
  root: ReactTestInstance,
  title: string,
): ReactTestInstance {
  const titleNode = root
    .findAllByType(Text)
    .find(node => node.props.children === title);
  if (titleNode == null) {
    throw new Error(`会话行标题未找到：${title}`);
  }
  let cursor: ReactTestInstance | null = titleNode;
  while (
    cursor != null &&
    (typeof cursor.props.onPress !== 'function' ||
      typeof cursor.props.onLongPress !== 'function')
  ) {
    cursor = cursor.parent;
  }
  if (cursor == null) {
    throw new Error(`会话行 Pressable 未找到：${title}`);
  }
  return cursor;
}

/** 菜单最后一次渲染的 props 快照（mock 组件每次渲染推一条）。 */
function lastMenu(): MenuCapture {
  const picked = menuCalls[menuCalls.length - 1];
  if (picked == null) {
    throw new Error('BottomSheetMenu 未渲染');
  }
  return picked;
}

type PanelOverrides = Partial<React.ComponentProps<typeof ChatSessionListPanel>>;

function baseProps(
  sessionId: string | undefined,
  sessions: ChatSession[],
  overrides: PanelOverrides = {},
): React.ComponentProps<typeof ChatSessionListPanel> {
  return {
    tokens,
    visible: true,
    sessionListPanel: 'sessions',
    onSessionListPanelChange: jest.fn(),
    projectId: 'p',
    sessionId,
    sessions,
    vfsRefreshKey: 0,
    projectVfs: null,
    projectWorktree: null,
    sessionBatchActive: false,
    sessionBatchSelectedCount: 0,
    onEnterSessionBatch: jest.fn(),
    onExitSessionBatch: jest.fn(),
    onConfirmBatchDelete: jest.fn(),
    onCreateSession: jest.fn(),
    onOpenConversation: jest.fn(),
    onToggleSessionSelect: jest.fn(),
    isSessionSelected: () => false,
    menuSessionId: undefined,
    onMenuSessionIdChange: jest.fn(),
    onOpenSessionRename: jest.fn(),
    onCopySession: jest.fn(),
    onConfirmDeleteSession: jest.fn(),
    onOpenFileEditor: jest.fn(),
    ...overrides,
  };
}

async function renderPanel(
  sessionId: string | undefined,
  sessions: ChatSession[],
  overrides: PanelOverrides = {},
): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ChatSessionListPanel {...baseProps(sessionId, sessions, overrides)} />,
    );
  });
  return renderer;
}

async function unmountPanel(
  renderer: TestRenderer.ReactTestRenderer,
): Promise<void> {
  await act(async () => {
    renderer.unmount();
  });
}

describe('ChatSessionListPanel 徽标（running / interrupted）与「活跃中」meta 判活', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.length = 0;
    menuCalls.length = 0;
    mockVfsMountCount.value = 0;
    mockManager.activeSessionIds.mockReturnValue([]);
    mockManager.interruptedSessionIds.mockReturnValue(new Set());
  });

  it('running→生成中；interrupted（无论是否当前会话）→已中断', async () => {
    // 当前会话 c 恰为中断态：GWT-6 原样复现场景
    mockManager.activeSessionIds.mockReturnValue(['a']);
    mockManager.interruptedSessionIds.mockReturnValue(new Set(['b', 'c']));
    const renderer = await renderPanel('c', [
      makeSession('a'),
      makeSession('b'),
      makeSession('c'),
    ]);
    const contents = textContents(renderer.root);

    // a（running，非当前）：生成中 + 唯一那一份「 · 活跃中」meta
    expect(countContaining(contents, '生成中')).toBe(1);
    expect(countContaining(contents, ' · 活跃中')).toBe(1);
    // b（interrupted 非当前）+ c（interrupted 当前）：各一枚已中断徽标
    expect(countContaining(contents, '已中断')).toBe(2);
    // 「当前」位置徽标与状态正交，c 照常保留
    expect(contents.filter(content => content === '当前')).toHaveLength(1);
    await unmountPanel(renderer);
  });

  it('interrupted 会话（当前与非当前）都不是运行态：一律不出「活跃中」meta', async () => {
    // 与上面那条对照，把 a 从活跃集里摘掉：此时三枚徽标里只剩「已中断」，
    // 「 · 活跃中」必须归零——它是判活 meta，不许退化回 isCurrent 标记。
    mockManager.activeSessionIds.mockReturnValue([]);
    mockManager.interruptedSessionIds.mockReturnValue(new Set(['b', 'c']));
    const renderer = await renderPanel('c', [
      makeSession('b'),
      makeSession('c'),
    ]);
    const contents = textContents(renderer.root);

    expect(countContaining(contents, '已中断')).toBe(2);
    expect(countContaining(contents, ' · 活跃中')).toBe(0);
    expect(countContaining(contents, '生成中')).toBe(0);
    expect(contents.filter(content => content === '当前')).toHaveLength(1);
    await unmountPanel(renderer);
  });

  it('GWT-7: 空闲当前会话（run 已收尾、无 run）不再显示「活跃中」', async () => {
    // 真机实录原样复现：新会话4 的一轮 run 已正常收尾（active 集清空），
    // 期间无新 run——旧的 isCurrent 判定会让「 · 活跃中」永久挂着。
    const renderer = await renderPanel('d', [
      makeSession('a'),
      makeSession('d'),
    ]);
    const contents = textContents(renderer.root);

    expect(countContaining(contents, ' · 活跃中')).toBe(0);
    // 「当前」位置徽标与 meta 行正交，照常保留（当前会话身份没有丢）
    expect(contents.filter(content => content === '当前')).toHaveLength(1);
    expect(countContaining(contents, '生成中')).toBe(0);
    expect(countContaining(contents, '已中断')).toBe(0);
    // meta 行只剩相对时间，不残留任何「活跃」字样
    expect(countContaining(contents, '活跃')).toBe(0);
    await unmountPanel(renderer);
  });

  it('GWT-7: 真在运行的会话（当前与非当前）照常显示「 · 活跃中」meta + 生成中徽标', async () => {
    mockManager.activeSessionIds.mockReturnValue(['a', 'c']);
    const renderer = await renderPanel('c', [
      makeSession('a'),
      makeSession('c'),
    ]);
    const contents = textContents(renderer.root);

    // 两个活跃会话各一份 meta + 徽标；当前会话 c 另有「当前」位置徽标
    expect(countContaining(contents, ' · 活跃中')).toBe(2);
    expect(countContaining(contents, '生成中')).toBe(2);
    expect(contents.filter(content => content === '当前')).toHaveLength(1);
    await unmountPanel(renderer);
  });

  it('GWT-7: run 收尾经 manager.subscribe 驱动刷新——活跃中 meta 与生成中徽标同时消失', async () => {
    mockManager.activeSessionIds.mockReturnValue(['a']);
    const renderer = await renderPanel('a', [makeSession('a')]);
    expect(countContaining(textContents(renderer.root), ' · 活跃中')).toBe(1);
    expect(countContaining(textContents(renderer.root), '生成中')).toBe(1);

    // RUN_FINISHED → 单元 settle 出 active 集 → notifyChanged → UI 刷新：
    // 收尾后徽标必须即时消失，不能留着当「还在跑」。
    mockManager.activeSessionIds.mockReturnValue([]);
    await act(async () => {
      for (const listener of [...mockListeners]) {
        listener();
      }
    });
    const contents = textContents(renderer.root);
    expect(countContaining(contents, ' · 活跃中')).toBe(0);
    expect(countContaining(contents, '生成中')).toBe(0);
    expect(contents.filter(content => content === '当前')).toHaveLength(1);
    await unmountPanel(renderer);
  });

  it('状态迁移经 manager.subscribe 驱动刷新：running 收尾→interrupted 水合→徽标切换', async () => {
    mockManager.activeSessionIds.mockReturnValue(['a']);
    const renderer = await renderPanel(undefined, [makeSession('a')]);
    expect(countContaining(textContents(renderer.root), '生成中')).toBe(1);

    // run 收尾 + 重启水合回 interrupted：两个数据源同沿 notifyChanged 通知
    mockManager.activeSessionIds.mockReturnValue([]);
    mockManager.interruptedSessionIds.mockReturnValue(new Set(['a']));
    await act(async () => {
      for (const listener of [...mockListeners]) {
        listener();
      }
    });
    const contents = textContents(renderer.root);
    expect(countContaining(contents, '已中断')).toBe(1);
    expect(countContaining(contents, '生成中')).toBe(0);
    await unmountPanel(renderer);
  });
});

describe('ChatSessionListPanel 会话列表本体 · 行渲染 / 批量 / 菜单', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.length = 0;
    menuCalls.length = 0;
    mockVfsMountCount.value = 0;
    mockManager.activeSessionIds.mockReturnValue([]);
    mockManager.interruptedSessionIds.mockReturnValue(new Set());
  });

  it('sessions 态渲染 RN 会话列表（FlatList），空列表给占位文案', async () => {
    const empty = await renderPanel(undefined, []);
    expect(findSessionList(empty.root)).not.toBeNull();
    expect(textContents(empty.root)).toContain('暂无会话');
    await unmountPanel(empty);

    const filled = await renderPanel('a', [makeSession('a'), makeSession('b')]);
    const contents = textContents(filled.root);
    expect(countContaining(contents, '暂无会话')).toBe(0);
    expect(contents).toContain('会话-a');
    expect(contents).toContain('会话-b');
    await unmountPanel(filled);
  });

  it('非批量态：ManageHeader 常规分支（有「管理」「新建会话」），无勾选框', async () => {
    const renderer = await renderPanel('a', [makeSession('a')]);
    const contents = textContents(renderer.root);
    expect(contents).toContain('新建会话');
    expect(contents).toContain('管理');
    expect(countContaining(contents, '已选')).toBe(0);
    expect(contents).toContain('⋮');
    await unmountPanel(renderer);
  });

  it('批量态：ManageHeader 走批量分支（取消 / 已选 N 项），⋮ 与「当前」徽标收起', async () => {
    const renderer = await renderPanel('a', [makeSession('a')], {
      sessionBatchActive: true,
      sessionBatchSelectedCount: 1,
      isSessionSelected: (id: string) => id === 'a',
    });
    const contents = textContents(renderer.root);
    // ManageHeader 批量分支：`已选 {n} 项` 的 n 是数字子节点，textContents 只
    // 拼字符串子节点，所以判「已选」这段文案在场即可（数字不入串）。
    expect(countContaining(contents, '已选')).toBe(1);
    expect(contents).toContain('取消');
    // 批量态下位置徽标与 ⋮ / › 一并收起
    expect(contents.filter(content => content === '当前')).toHaveLength(0);
    expect(contents).not.toContain('⋮');
    await unmountPanel(renderer);
  });

  it('点会话行：非批量态走 onOpenConversation', async () => {
    const onOpenConversation = jest.fn();
    const renderer = await renderPanel('a', [makeSession('a')], {
      onOpenConversation,
    });
    const row = findSessionRow(renderer.root, '会话-a');
    await act(async () => {
      (row.props.onPress as () => void)();
    });
    expect(onOpenConversation).toHaveBeenCalledWith('a');
    await unmountPanel(renderer);
  });

  it('点会话行：批量态改走 onToggleSessionSelect（不开对话）', async () => {
    const onToggleSessionSelect = jest.fn();
    const onOpenConversation = jest.fn();
    const renderer = await renderPanel('a', [makeSession('a')], {
      sessionBatchActive: true,
      onToggleSessionSelect,
      onOpenConversation,
    });
    const row = findSessionRow(renderer.root, '会话-a');
    await act(async () => {
      (row.props.onPress as () => void)();
    });
    expect(onToggleSessionSelect).toHaveBeenCalledWith('a');
    expect(onOpenConversation).not.toHaveBeenCalled();
    await unmountPanel(renderer);
  });

  it('长按会话行：进批量并选中该行', async () => {
    const onEnterSessionBatch = jest.fn();
    const onToggleSessionSelect = jest.fn();
    const renderer = await renderPanel('a', [makeSession('a')], {
      onEnterSessionBatch,
      onToggleSessionSelect,
    });
    const row = findSessionRow(renderer.root, '会话-a');
    await act(async () => {
      (row.props.onLongPress as () => void)();
    });
    expect(onEnterSessionBatch).toHaveBeenCalled();
    expect(onToggleSessionSelect).toHaveBeenCalledWith('a');
    await unmountPanel(renderer);
  });

  it('⋮ 菜单：活跃会话多一项「停止生成」并走 manager.stopRun；重命名/复制/删除回调正确接线', async () => {
    const onOpenSessionRename = jest.fn();
    const onCopySession = jest.fn();
    const onConfirmDeleteSession = jest.fn();
    const onMenuSessionIdChange = jest.fn();

    mockManager.activeSessionIds.mockReturnValue(['a']);
    const renderer = await renderPanel('a', [makeSession('a')], {
      menuSessionId: 'a',
      onMenuSessionIdChange,
      onOpenSessionRename,
      onCopySession,
      onConfirmDeleteSession,
    });

    const menu = lastMenu();
    expect(menu.visible).toBe(true);
    expect(menu.labels).toEqual(['停止生成', '重命名', '复制', '删除']);

    await act(async () => {
      menu.select('stop-generating');
    });
    expect(mockManager.stopRun).toHaveBeenCalledWith('a');
    expect(onMenuSessionIdChange).toHaveBeenCalledWith(undefined);

    await act(async () => {
      lastMenu().select('rename');
    });
    expect(onOpenSessionRename).toHaveBeenCalledWith('a');

    await act(async () => {
      lastMenu().select('copy');
    });
    expect(onCopySession).toHaveBeenCalledWith('a');

    await act(async () => {
      lastMenu().select('delete');
    });
    expect(onConfirmDeleteSession).toHaveBeenCalledWith('a');
    await unmountPanel(renderer);
  });

  it('非活跃会话的 ⋮ 菜单不出现「停止生成」', async () => {
    const renderer = await renderPanel('a', [makeSession('a')], {
      menuSessionId: 'a',
    });
    expect(lastMenu().labels).toEqual(['重命名', '复制', '删除']);
    await unmountPanel(renderer);
  });

  it('未开菜单（menuSessionId=undefined）时菜单不可见', async () => {
    const renderer = await renderPanel('a', [makeSession('a')]);
    const menu = lastMenu();
    expect(menu.visible).toBe(false);
    // items 恒按「非活跃」那档铺（可见性由 visible 判），不在 items 上做断言。
    await unmountPanel(renderer);
  });
});

describe('ChatSessionListPanel projects 分支 · VfsFileManager 挂载与 key', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    menuCalls.length = 0;
    mockVfsMountCount.value = 0;
    mockManager.activeSessionIds.mockReturnValue([]);
    mockManager.interruptedSessionIds.mockReturnValue(new Set());
  });

  it('projects 态挂载 VfsFileManager，key 含 vfsRefreshKey（vfsRefreshKey 变即整实例重挂）', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ChatSessionListPanel
          {...baseProps(undefined, [], {
            sessionListPanel: 'projects',
            projectVfs: {} as never,
            projectWorktree: {} as never,
            vfsRefreshKey: 1,
          })}
        />,
      );
    });
    expect(mockVfsMountCount.value).toBe(1);

    // key 里含 vfsRefreshKey → 换 key 即重挂（mount 计数 +1）；key 若被摘掉
    // vfsRefreshKey，这里就只会走 update 不会重挂。
    await act(async () => {
      renderer.update(
        <ChatSessionListPanel
          {...baseProps(undefined, [], {
            sessionListPanel: 'projects',
            projectVfs: {} as never,
            projectWorktree: {} as never,
            vfsRefreshKey: 2,
          })}
        />,
      );
    });
    expect(mockVfsMountCount.value).toBe(2);
    await unmountPanel(renderer);
  });

  it('无可用工作区时给占位文案「请先选择项目」而不是空白', async () => {
    const renderer = await renderPanel(undefined, [], {
      sessionListPanel: 'projects',
      projectVfs: null,
      projectWorktree: null,
    });
    expect(textContents(renderer.root)).toContain('请先选择项目');
    expect(mockVfsMountCount.value).toBe(0);
    await unmountPanel(renderer);
  });

  it('projects 态不挂会话列表（RN 会话列表本体不渲染）', async () => {
    const renderer = await renderPanel('a', [makeSession('a')], {
      sessionListPanel: 'projects',
    });
    expect(findSessionList(renderer.root)).toBeNull();
    expect(textContents(renderer.root)).not.toContain('会话-a');
    await unmountPanel(renderer);
  });

  it('visible=false 整行收起：切到对话视图后列表不占位', async () => {
    const renderer = await renderPanel('a', [makeSession('a')], {
      visible: false,
    });
    const root = renderer.root;
    const styleProps = root
      .findAll(node => node.props?.style != null, {deep: true})
      .flatMap(node => {
        const style = node.props.style;
        return Array.isArray(style) ? style : [style];
      })
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item != null,
      );
    expect(styleProps.some(item => item.display === 'none')).toBe(true);
    await unmountPanel(renderer);
  });
});
