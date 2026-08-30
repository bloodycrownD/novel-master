/**
 * comp-chat/C-1：buildTokenInsertion 覆盖四条插入路径（@ 选择器 / $ 选择器 /
 * @ typeahead / $ typeahead）与空格补齐边界；statusOnlyComposerAttachments
 * 锁定「draft 只保留状态 chip」的过滤口径。
 */
import {
  buildTokenInsertion,
  statusOnlyComposerAttachments,
} from '@/components/chat/composer-token-insert';
import type { MessageAttachment } from '@novel-master/core/chat';

describe('buildTokenInsertion', () => {
  test('@ 选择器多选：前段无尾空白补前导空格，末尾补尾空格，多 token 空格连接', () => {
    const next = buildTokenInsertion('你好', 2, 2, [
      '@docs/a.md',
      '@docs/b/',
    ]);
    expect(next.text).toBe('你好 @docs/a.md @docs/b/ ');
    expect(next.cursor).toBe('你好 @docs/a.md @docs/b/ '.length);
  });

  test('$ 选择器：前段无尾空白补前导空格，末尾补尾空格', () => {
    const next = buildTokenInsertion('跑一下', 3, 3, '$写作');
    expect(next.text).toBe('跑一下 $写作 ');
    expect(next.cursor).toBe('跑一下 $写作 '.length);
  });

  test('@ typeahead：从触发字符起替换，前段已以空白结尾不补前导空格', () => {
    // '见 @ab'：activeAt.start = 2，cursor = 5
    const next = buildTokenInsertion('见 @ab', 5, 2, '@x.md');
    expect(next.text).toBe('见 @x.md ');
    expect(next.cursor).toBe('见 @x.md '.length);
  });

  test('$ typeahead：从触发字符起替换，前段已以空白结尾不补前导空格', () => {
    // '来 $写'：activeSkill.start = 2，cursor = 4
    const next = buildTokenInsertion('来 $写', 4, 2, '$大纲');
    expect(next.text).toBe('来 $大纲 ');
    expect(next.cursor).toBe('来 $大纲 '.length);
  });

  test('空格边界：换行结尾不补前导空格；后段以空白开头不补尾空格；空文本直插', () => {
    expect(buildTokenInsertion('a\n', 2, 2, '@x').text).toBe('a\n@x ');
    expect(buildTokenInsertion('@a and more', 2, 0, '@b')).toEqual({
      text: '@b and more',
      cursor: 2,
    });
    expect(buildTokenInsertion('', 0, 0, '$技能')).toEqual({
      text: '$技能 ',
      cursor: '$技能 '.length,
    });
  });
});

describe('statusOnlyComposerAttachments', () => {
  test('只保留 workplace / user_ops 状态 chip，过滤 attach 来源', () => {
    const chip = (source: MessageAttachment['source']): MessageAttachment => ({
      name: 'a.md',
      source,
      type: 'text',
      content: null,
      path: 'a.md',
    });
    const out = statusOnlyComposerAttachments([
      chip('workplace'),
      chip('attach'),
      chip('user_ops'),
    ]);
    expect(out.map(a => a.source)).toEqual(['workplace', 'user_ops']);
  });
});
