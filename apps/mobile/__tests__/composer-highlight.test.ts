import cases from './fixtures/composer-token-cases.json';
import {
  composerTokenRanges,
  isValidTokenRangeText,
  splitComposerTokenSegments,
} from '@/components/chat/composer-highlight';

describe('composerTokenRanges / splitComposerTokenSegments', () => {
  it('F-A1: 用例表（明文形态 → 区间）逐条读表', () => {
    for (const {plain, ranges} of cases) {
      expect({plain, ranges: composerTokenRanges(plain)}).toEqual({
        plain,
        ranges,
      });
    }
  });

  it('终止符语义：胶囊后的普通文字不会被吞', () => {
    expect(composerTokenRanges('$写文档$总结')).toEqual([{start: 0, end: 5}]);
    expect(composerTokenRanges('$写文档总结')).toEqual([]);
    expect(splitComposerTokenSegments('帮我$写文档$看下')).toEqual([
      {kind: 'plain', text: '帮我'},
      {kind: 'token', text: '$写文档$'},
      {kind: 'plain', text: '看下'},
    ]);
  });

  it('相邻两颗胶囊天然可分，空体与孤立触发符不成 token', () => {
    expect(splitComposerTokenSegments('$A$$B$')).toEqual([
      {kind: 'token', text: '$A$'},
      {kind: 'token', text: '$B$'},
    ]);
    expect(composerTokenRanges('$$ @@ $ $')).toEqual([]);
    expect(splitComposerTokenSegments('a $ b')).toEqual([
      {kind: 'plain', text: 'a $ b'},
    ]);
    expect(splitComposerTokenSegments('price: 100$')).toEqual([
      {kind: 'plain', text: 'price: 100$'},
    ]);
  });

  it('@ 与 $ 各自成型（字符类互斥），无前置空白要求', () => {
    expect(splitComposerTokenSegments('@a@$b$')).toEqual([
      {kind: 'token', text: '@a@'},
      {kind: 'token', text: '$b$'},
    ]);
    expect(composerTokenRanges('我看到@/a.md@')).toEqual([{start: 3, end: 10}]);
  });

  it('空串与纯文本原样单段', () => {
    expect(splitComposerTokenSegments('')).toEqual([{kind: 'plain', text: ''}]);
    expect(splitComposerTokenSegments('纯文本，无 token')).toEqual([
      {kind: 'plain', text: '纯文本，无 token'},
    ]);
  });

  it('ranges 与 segments 一致性：坐标逐条对齐、拼接还原原文', () => {
    const samples = [
      ...cases.map(item => item.plain),
      '帮我看看@/a.md@谢谢',
      '纯文本',
      '',
    ];

    for (const plain of samples) {
      const ranges = composerTokenRanges(plain);
      const segments = splitComposerTokenSegments(plain);
      const tokenSegments = segments.filter(s => s.kind === 'token');

      expect(tokenSegments.length).toBe(ranges.length);

      let tokenIndex = 0;
      for (const segment of segments) {
        if (segment.kind === 'token') {
          const range = ranges[tokenIndex++];
          expect(segment.text).toBe(plain.slice(range.start, range.end));
        }
      }

      expect(segments.map(s => s.text).join('')).toBe(plain);
    }
  });
});

describe('isValidTokenRangeText（水化自愈判据）', () => {
  it('整段恰好一颗胶囊才合法', () => {
    expect(isValidTokenRangeText('$写文档$', {start: 0, end: 5})).toBe(true);
    expect(isValidTokenRangeText('x$写文档$', {start: 1, end: 6})).toBe(true);
    expect(isValidTokenRangeText('$写文档$总结', {start: 0, end: 5})).toBe(true);
  });

  it('旧格式 / 半截 / 越界 / 空区间一律不合法', () => {
    // 旧格式（无尾终止符）
    expect(isValidTokenRangeText('$写文档总结', {start: 0, end: 5})).toBe(false);
    // 半截区间：切片里有触发符但没有收尾
    expect(isValidTokenRangeText('$写文档$', {start: 0, end: 3})).toBe(false);
    // 越界
    expect(isValidTokenRangeText('$A$', {start: 0, end: 10})).toBe(false);
    // 空 / 反向
    expect(isValidTokenRangeText('$A$', {start: 0, end: 0})).toBe(false);
    expect(isValidTokenRangeText('$A$', {start: 2, end: 1})).toBe(false);
    // 首尾不同字符
    expect(isValidTokenRangeText('@a$', {start: 0, end: 3})).toBe(false);
  });
});
