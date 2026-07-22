/**
 * transcript 划词选区 bridge 契约（T-MA7 / remove-assistant-message-annotate）。
 * menuItems 与 RICH_DOCUMENT 同形见 ChatTranscriptWebView 源码注释（批注+复制）。
 * 批注仅 user：上溯 `.row.message.user`；assistant 不进 store。
 */
import { RESOLVE_SELECTION_ANNOTATE_JS } from '../src/components/chat/ChatTranscriptBridge';

describe('chat-transcript-selection-annotate (T-MA7)', () => {
  test('RESOLVE_SELECTION_ANNOTATE_JS 仅上溯 .row.message.user[data-id]', () => {
    expect(RESOLVE_SELECTION_ANNOTATE_JS).toContain(
      '.row.message.user[data-id]',
    );
    expect(RESOLVE_SELECTION_ANNOTATE_JS).not.toContain(
      ".closest('.row.message[data-id]')",
    );
    expect(RESOLVE_SELECTION_ANNOTATE_JS).toContain('selectionAnnotate');
    expect(RESOLVE_SELECTION_ANNOTATE_JS).toContain('getSelection');
  });

  test('assistant 行选择器无法匹配：user 选择器不含 assistant 类', () => {
    // 注入脚本要求 closest('.row.message.user[data-id]')；
    // class="row message assistant" 不满足 .user → messageId 空 → 宿主取消
    expect(RESOLVE_SELECTION_ANNOTATE_JS).toMatch(
      /\.row\.message\.user\[data-id\]/,
    );
  });
});
