/**
 * transcript 划词选区菜单契约（remove-message-annotate）：仅「复制」。
 * 不导入 RichDocumentWebView（会拉 Clipboard 原生模块）；文件预览菜单另有测。
 */
import { CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS } from '../src/components/chat/chat-transcript-selection-menu';

describe('chat-transcript-selection-menu (copy-only)', () => {
  test('transcript menuItems 仅含复制，不含批注', () => {
    expect(CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS).toEqual([
      {label: '复制', key: 'copy'},
    ]);
    expect(
      CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS.some(i => i.key === 'annotate'),
    ).toBe(false);
  });
});
