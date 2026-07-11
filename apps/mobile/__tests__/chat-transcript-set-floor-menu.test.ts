/**
 * T-SF11/12：WebView buildMenuItems 置位资格（镜像 main.ts 逻辑，不 export 生产函数）。
 */

type WebViewMenuRow = {
  kind: string;
  role?: string;
  text?: string;
  hidden?: boolean;
};

type HitEl = {
  closest?: (selector: string) => unknown;
};

/** Mirrors apps/mobile/src/web/chat-transcript/main.ts buildMenuItems set-floor rules. */
function buildWebViewMenuActions(row: WebViewMenuRow, hitEl?: HitEl | null): string[] {
  const items: string[] = [];
  if (row.text) items.push('edit');
  items.push('copy');
  const showSetFloor =
    row.kind === 'message' &&
    (row.role === 'user' || row.role === 'assistant') &&
    !(hitEl?.closest?.('.tool-card, .tool-group-item'));
  if (showSetFloor) items.push('set-floor');
  items.push('fork');
  if (!row.hidden) items.push('rollback');
  return items;
}

function mockHitEl(matchingSelector: string | null): HitEl {
  return {
    closest(selector: string) {
      return matchingSelector === selector ? {} : null;
    },
  };
}

describe('WebView buildMenuItems set-floor eligibility', () => {
  it('T-SF11: user_vfs_turn 行菜单无 set-floor', () => {
    const actions = buildWebViewMenuActions({
      kind: 'user_vfs_turn',
      role: 'user',
    });
    expect(actions).not.toContain('set-floor');
  });

  it('T-SF12: tool-card hit 时 message 行菜单无 set-floor', () => {
    const actions = buildWebViewMenuActions(
      {
        kind: 'message',
        role: 'assistant',
        text: 'tool reply',
      },
      mockHitEl('.tool-card, .tool-group-item'),
    );
    expect(actions).not.toContain('set-floor');
    expect(actions).toEqual(['edit', 'copy', 'fork', 'rollback']);
  });

  it('普通 user message 行含 set-floor', () => {
    const actions = buildWebViewMenuActions({
      kind: 'message',
      role: 'user',
      text: 'hello',
    });
    expect(actions).toContain('set-floor');
  });
});
