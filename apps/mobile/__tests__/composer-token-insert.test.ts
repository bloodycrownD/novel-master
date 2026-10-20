/**
 * comp-chat/C-1：buildTokenInsertion 覆盖四条插入路径（@ 选择器 / $ 选择器 /
 * @ typeahead / $ typeahead）与空格补齐边界；statusOnlyComposerAttachments
 * 锁定「draft 只保留状态 chip」的过滤口径。
 */
import {
  buildTokenInsertion,
  statusOnlyComposerAttachments,
} from '@/components/chat/composer-token-insert';
import type {MessageAttachment} from '@novel-master/core/chat';

describe('buildTokenInsertion', () => {
  test('@ 选择器多选：直接拼接、零分隔空格（chip 模型，2026-10-20 用户定口径）', () => {
    const next = buildTokenInsertion('你好', 2, 2, ['@docs/a.md', '@docs/b/']);
    expect(next.text).toBe('你好@docs/a.md@docs/b/');
    expect(next.cursor).toBe('你好@docs/a.md@docs/b/'.length);
  });

  test('$ 选择器：前段无尾空白也直插，不补前导/尾空格', () => {
    const next = buildTokenInsertion('跑一下', 3, 3, '$写作');
    expect(next.text).toBe('跑一下$写作');
    expect(next.cursor).toBe('跑一下$写作'.length);
  });

  test('@ typeahead：从触发字符起替换，前段原样保留（含其自带空格）', () => {
    // '见 @ab'：activeAt.start = 2，cursor = 5——before='见 ' 的空格是源文本
    const next = buildTokenInsertion('见 @ab', 5, 2, '@x.md');
    expect(next.text).toBe('见 @x.md');
    expect(next.cursor).toBe('见 @x.md'.length);
  });

  test('$ typeahead：从触发字符起替换，前段原样保留', () => {
    // '来 $写'：activeSkill.start = 2，cursor = 4
    const next = buildTokenInsertion('来 $写', 4, 2, '$大纲');
    expect(next.text).toBe('来 $大纲');
    expect(next.cursor).toBe('来 $大纲'.length);
  });

  test('空文本与替换边界：直插不补空格；替换不破坏后段', () => {
    expect(buildTokenInsertion('a\n', 2, 2, '@x').text).toBe('a\n@x');
    expect(buildTokenInsertion('@a and more', 2, 0, '@b')).toEqual({
      text: '@b and more',
      cursor: 2,
      tokenRanges: [{start: 0, end: 2}],
    });
    expect(buildTokenInsertion('', 0, 0, '$技能')).toEqual({
      text: '$技能',
      cursor: 3,
      tokenRanges: [{start: 0, end: 3}],
    });
  });

  test('tokenRanges：多 token 逐个登记、相邻不重叠（下标针对返回 text）', () => {
    const next = buildTokenInsertion('你好', 2, 2, ['@docs/a.md', '@docs/b/']);
    expect(next.tokenRanges).toEqual([
      {start: 2, end: 12},
      {start: 12, end: 20},
    ]);
    // 区间与返回 text 对齐：逐段切出来正是两个 token 本体
    expect(next.text.slice(2, 12)).toBe('@docs/a.md');
    expect(next.text.slice(12, 20)).toBe('@docs/b/');
    // typeahead 替换半截查询：区间落在替换后的插入段内
    const ta = buildTokenInsertion('见 @ab', 5, 2, '@x.md');
    expect(ta.tokenRanges).toEqual([{start: 2, end: 7}]);
    expect(ta.text.slice(2, 7)).toBe('@x.md');
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
