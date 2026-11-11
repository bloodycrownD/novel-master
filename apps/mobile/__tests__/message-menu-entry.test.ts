/**
 * T-MN1 / T-MN2：消息菜单项集合 + 右上角 ⋯ 入口接线。
 *
 * 全部是 webview 侧脚本文本契约（menu.ts / MessageRow / bind-shell-events），
 * 与 boot-script/annotate-* 同类，保留源码契约。
 *
 * Step 8：原第三段「legacy MessageList 同步 ⋯ 入口」（读 `MessageList.tsx` 源码
 * 断 `MessageMenuRow` / `onLongPress` 缺席）随 legacy RN 转录引擎退役删除——
 * 被测文件本身已不存在。RN 侧锚定消息菜单（`MessageActionMenu.tsx`）同期退场，
 * 消息菜单只剩 web 文档内这一张。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {openContextMenuFromAnchor} from '../src/web/chat-transcript/webview/runtime/menu/menu';
import {state} from '../src/web/chat-transcript/webview/runtime/state/state';

const root = join(__dirname, '..');

function readSrc(...parts: string[]): string {
  return readFileSync(join(root, ...parts), 'utf8');
}

type PostedEnvelope = {
  v: number;
  type: string;
  payload: Record<string, unknown>;
};

/** 捕获上行信封（@web/shared/post 出口为 fake window.ReactNativeWebView）。 */
function postedEnvelopes(): PostedEnvelope[] {
  const bridge = (
    window as unknown as {
      ReactNativeWebView?: {postMessage: (msg: string) => void};
    }
  ).ReactNativeWebView;
  if (!bridge) return [];
  return (bridge.postMessage as unknown as jest.Mock).mock.calls.map(call =>
    JSON.parse(call[0] as string),
  );
}

describe('message menu entry (T-MN1 / T-MN2)', () => {
  it('T-MN1: Web buildMenuItems 集合仍为编辑/复制/置位(user)/分叉/回滚', () => {
    const menu = readSrc(
      'src/web/chat-transcript/webview/runtime/menu/menu.ts',
    );
    expect(menu).toContain("label: '编辑'");
    expect(menu).toContain("label: '复制'");
    expect(menu).toContain("label: '置位'");
    expect(menu).toContain("label: '分叉'");
    expect(menu).toContain("label: '回滚'");
    expect(menu).not.toMatch(/label:\s*['"]隐藏/);
    expect(menu).not.toMatch(/label:\s*['"]删除/);
  });

  it('T-MN2: MessageRow ⋯ 调用 openContextMenuFromAnchor；bind-shell 无长按开菜单', () => {
    const messageRow = readSrc(
      'src/web/chat-transcript/webview/ui/render/MessageRow.tsx',
    );
    const bindShell = readSrc(
      'src/web/chat-transcript/webview/runtime/boot/bind-shell-events.ts',
    );
    const menu = readSrc(
      'src/web/chat-transcript/webview/runtime/menu/menu.ts',
    );
    expect(messageRow).toContain('message-menu-btn');
    expect(messageRow).toContain('message-menu-row');
    expect(messageRow).toContain('message-role-label');
    expect(messageRow).toContain('用户');
    expect(messageRow).toContain('助手');
    expect(messageRow).toContain('openContextMenuFromAnchor');
    expect(messageRow).toContain('getBoundingClientRect');
    expect(messageRow).not.toContain('message-menu-toolbar');
    expect(messageRow).not.toContain('bubble--menu-corner');
    expect(messageRow).not.toContain('menuSlot');
    expect(menu).toContain('export function openContextMenuFromAnchor');
    expect(bindShell).not.toContain('onMessagePointerDown');
    expect(bindShell).not.toContain('touchstart');
    expect(bindShell).toContain('onRowsClick');
  });
});

/**
 * P2-18d：上面的源码契约只能证明「写了 messageId ?? id」，钉不住落点。
 * 这里用真实 `openContextMenuFromAnchor` + fake state/window 跑行为：流式行
 * id 开菜单时，上行 `messageId` 必须是 DB id（C28），退回 `row.id` 会让
 * 回滚/分叉/置位找不到 DB 消息。
 */
describe('message menu entry · 行为（C28 DB id 落点）', () => {
  let postMessage: jest.Mock;

  beforeEach(() => {
    postMessage = jest.fn();
    (window as unknown as {ReactNativeWebView?: unknown}).ReactNativeWebView = {
      postMessage,
    };
    state.rows = [];
    state.menu = null;
    state.menuOpenedAt = 0;
    state.flags = {richText: false, menuDisabled: false};
  });

  afterEach(() => {
    delete (window as unknown as {ReactNativeWebView?: unknown})
      .ReactNativeWebView;
    state.rows = [];
    state.menu = null;
    state.menuOpenedAt = 0;
  });

  it('T-MN3: 用流式行 id 开菜单 → 上行 messageId 用 DB id', () => {
    state.rows = [
      {
        kind: 'message',
        id: 'st:1',
        messageId: 'db-1',
        role: 'assistant',
        status: 'finished',
        text: 'hi',
      },
    ];
    openContextMenuFromAnchor('st:1', {x: 10, y: 20, width: 30, height: 40});
    expect(postedEnvelopes()).toEqual([
      {
        v: 1,
        type: 'openMessageMenu',
        payload: {messageId: 'db-1', pageX: 25, pageY: 40},
      },
      {v: 1, type: 'menuOpened', payload: {}},
    ]);
    expect(state.menu?.messageId).toBe('db-1');
  });

  it('T-MN4: 历史行无 messageId → 回落 row.id', () => {
    state.rows = [
      {kind: 'message', id: 'db-2', role: 'user', hidden: false, text: 'yo'},
    ];
    openContextMenuFromAnchor('db-2', {x: 0, y: 0, width: 0, height: 0});
    expect(postedEnvelopes()).toEqual([
      {
        v: 1,
        type: 'openMessageMenu',
        payload: {messageId: 'db-2', pageX: 0, pageY: 0},
      },
      {v: 1, type: 'menuOpened', payload: {}},
    ]);
  });

  it('T-MN5: 行不存在 → 不上行任何消息', () => {
    state.rows = [{kind: 'message', id: 'db-3', role: 'user', hidden: false}];
    openContextMenuFromAnchor('st-missing', {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(postedEnvelopes()).toEqual([]);
    expect(state.menu).toBeNull();
  });
});
