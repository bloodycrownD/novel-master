/**
 * transcript 划词选区 bridge 契约（T-MA7 部分）。
 * menuItems 与 RICH_DOCUMENT 同形见 ChatTranscriptWebView 源码注释（批注+复制）。
 */
import { RESOLVE_SELECTION_ANNOTATE_JS } from '../src/components/chat/ChatTranscriptBridge';

describe('chat-transcript-selection-annotate (T-MA7)', () => {
  test('RESOLVE_SELECTION_ANNOTATE_JS 上溯 .row.message[data-id]', () => {
    expect(RESOLVE_SELECTION_ANNOTATE_JS).toContain('.row.message[data-id]');
    expect(RESOLVE_SELECTION_ANNOTATE_JS).toContain('selectionAnnotate');
    expect(RESOLVE_SELECTION_ANNOTATE_JS).toContain('getSelection');
  });
});
