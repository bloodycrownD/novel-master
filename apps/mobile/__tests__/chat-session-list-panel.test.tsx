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

describe('ChatSessionListPanel 徽标（running / interrupted）与「活跃中」meta 判活', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.length = 0;
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
