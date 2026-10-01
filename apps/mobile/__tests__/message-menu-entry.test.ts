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

const root = join(__dirname, '..');

function readSrc(...parts: string[]): string {
  return readFileSync(join(root, ...parts), 'utf8');
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
