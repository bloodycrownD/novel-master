/**
 * T-SF12：WebView buildMenuItems 置位资格（镜像 main.ts 逻辑，不 export 生产函数）。
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

/** Mirrors chat-transcript menu set-floor rules (webview-dist / src/menu.ts). */
function buildWebViewMenuActions(
  row: WebViewMenuRow,
  hitEl?: HitEl | null,
): string[] {
  const items: string[] = [];
  if (row.text) items.push('edit');
  items.push('copy');
  if (row.hidden) items.push('unhide');
  const showSetFloor =
    row.kind === 'message' &&
    row.role === 'user' &&
    !hitEl?.closest?.('.tool-card, .tool-group-item');
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

  it('普通 user message 行含 set-floor（T-MN1 集合）', () => {
    const actions = buildWebViewMenuActions({
      kind: 'message',
      role: 'user',
      text: 'hello',
    });
    expect(actions).toEqual(['edit', 'copy', 'set-floor', 'fork', 'rollback']);
  });

  it('assistant message 行不含 set-floor', () => {
    const actions = buildWebViewMenuActions({
      kind: 'message',
      role: 'assistant',
      text: 'reply',
    });
    expect(actions).not.toContain('set-floor');
    expect(actions).toEqual(['edit', 'copy', 'fork', 'rollback']);
  });
});

describe('WebView buildMenuItems unhide（T-UH3 镜像）', () => {
  it('hidden 行含 unhide，位置在 copy 之后、无 rollback', () => {
    const actions = buildWebViewMenuActions({
      kind: 'message',
      role: 'user',
      text: 'hi',
      hidden: true,
    });
    expect(actions).toEqual(['edit', 'copy', 'unhide', 'set-floor', 'fork']);
  });

  it('非 hidden 行不含 unhide', () => {
    const actions = buildWebViewMenuActions({
      kind: 'message',
      role: 'user',
      text: 'hi',
    });
    expect(actions).not.toContain('unhide');
    expect(actions).toEqual(['edit', 'copy', 'set-floor', 'fork', 'rollback']);
  });
});
