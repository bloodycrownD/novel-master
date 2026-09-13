/**
 * ChatSessionListPanel 徽标三态判定测试（T-X1，Step 9 / GWT-6）。
 *
 * 优先级 running > interrupted > isCurrent：
 * - running（activeRunIds 含该会话）→「生成中」徽标；
 * - interrupted（interruptedRunIds 含该会话，无论是否当前会话）→「已中断」徽标；
 * - isCurrent 且非上述两态 → 保留「 · 活跃中」meta 语义。
 *
 * 「当前会话×interrupted」必须落「已中断」——会话中断后重启 app 且当前停留
 * 在该会话时，按「interrupted 且非当前会话」判定会把该组合吞进「活跃中」、
 * bug 原样保留，此处正是该场景的原样复现断言。
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

jest.mock('@/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: () => null,
}));

jest.mock('@/components/vfs/VfsFileManager', () => ({
  VfsFileManager: () => null,
}));

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

async function renderPanel(
  sessionId: string | undefined,
  sessions: ChatSession[],
): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ChatSessionListPanel
        tokens={tokens}
        visible={true}
        sessionListPanel="sessions"
        onSessionListPanelChange={jest.fn()}
        projectId="p"
        sessionId={sessionId}
        sessions={sessions}
        vfsRefreshKey={0}
        projectVfs={null}
        projectWorktree={null}
        sessionBatchActive={false}
        sessionBatchSelectedCount={0}
        onEnterSessionBatch={jest.fn()}
        onExitSessionBatch={jest.fn()}
        onConfirmBatchDelete={jest.fn()}
        onCreateSession={jest.fn()}
        onOpenConversation={jest.fn()}
        onToggleSessionSelect={jest.fn()}
        isSessionSelected={() => false}
        menuSessionId={undefined}
        onMenuSessionIdChange={jest.fn()}
        onOpenSessionRename={jest.fn()}
        onCopySession={jest.fn()}
        onConfirmDeleteSession={jest.fn()}
        onOpenFileEditor={jest.fn()}
      />,
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

describe('T-X1: ChatSessionListPanel 徽标三态（running > interrupted > isCurrent）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.length = 0;
    mockManager.activeSessionIds.mockReturnValue([]);
    mockManager.interruptedSessionIds.mockReturnValue(new Set());
  });

  it('running→生成中；interrupted（无论是否当前会话）→已中断；不与活跃中并存', async () => {
    // 当前会话 c 恰为中断态：GWT-6 原样复现场景
    mockManager.activeSessionIds.mockReturnValue(['a']);
    mockManager.interruptedSessionIds.mockReturnValue(new Set(['b', 'c']));
    const renderer = await renderPanel('c', [
      makeSession('a'),
      makeSession('b'),
      makeSession('c'),
    ]);
    const contents = textContents(renderer.root);

    // a（running，非当前）：生成中
    expect(countContaining(contents, '生成中')).toBe(1);
    // b（interrupted 非当前）+ c（interrupted 当前）：各一枚已中断徽标
    expect(countContaining(contents, '已中断')).toBe(2);
    // c 是当前会话但处于中断态：活跃中 meta 必须被「已中断」压掉（不许吞进活跃中）
    expect(countContaining(contents, ' · 活跃中')).toBe(0);
    // 「当前」位置徽标与状态正交，c 照常保留
    expect(contents.filter(content => content === '当前')).toHaveLength(1);
    await unmountPanel(renderer);
  });

  it('普通当前会话（非 running 非 interrupted）保留「活跃中」语义', async () => {
    const renderer = await renderPanel('d', [
      makeSession('a'),
      makeSession('d'),
    ]);
    const contents = textContents(renderer.root);

    expect(countContaining(contents, ' · 活跃中')).toBe(1);
    expect(contents.filter(content => content === '当前')).toHaveLength(1);
    expect(countContaining(contents, '生成中')).toBe(0);
    expect(countContaining(contents, '已中断')).toBe(0);
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
