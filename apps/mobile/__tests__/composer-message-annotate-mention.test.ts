/**
 * 消息正文批注 mention / 发送前剥离（T-MA2/T-MA5 相关纯函数）。
 */
import {
  formatMessageAnnotateMentionMarkup,
  formatMessageAnnotateShortLabel,
  listMessageAnnotateDraftIdsInMentionValue,
  MESSAGE_ANNOTATE_TRIGGER,
} from '../src/components/chat/composer-message-annotate-mention';
import {
  mentionValueToPlain,
  mentionValueToSendUserContent,
} from '../src/components/chat/composer-at-path-mention';

describe('composer-message-annotate-mention', () => {
  test('T-MA2 短标签不以 @ 开头；内嵌 @ 显示为全角', () => {
    const label = formatMessageAnnotateShortLabel('见 @/foo.md 处');
    expect(label.startsWith('@')).toBe(false);
    expect(label).toContain('＠/foo.md');
    expect(label).not.toContain('@/foo.md');
  });

  test('T-MA5 发送 plain 剥离消息批注 span，保留 @path', () => {
    const draftId = 'msg-ann-1';
    const msgMarkup = formatMessageAnnotateMentionMarkup(
      draftId,
      '原文含 @/foo.md',
    );
    const mention = `前言 {@}[/a.md](/a.md) ${msgMarkup} 尾`;
    const sendPlain = mentionValueToSendUserContent(mention);
    expect(sendPlain).toContain('@/a.md');
    expect(sendPlain).not.toContain(MESSAGE_ANNOTATE_TRIGGER);
    expect(sendPlain).not.toContain('批:「');
    // 短标签内嵌的 @/foo 不得残留进发送正文
    expect(sendPlain).not.toMatch(/@\/foo\.md/);
  });

  test('对外展示 plain 含短标签但不以 @ 作前缀', () => {
    const draftId = 'd1';
    const markup = formatMessageAnnotateMentionMarkup(draftId, 'hello');
    const plain = mentionValueToPlain(markup);
    expect(plain.startsWith('@')).toBe(false);
    expect(plain).toContain('批:「');
    expect(listMessageAnnotateDraftIdsInMentionValue(markup)).toEqual([
      draftId,
    ]);
  });
});
