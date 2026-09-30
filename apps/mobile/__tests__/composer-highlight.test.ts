import {
  composerTokenRanges,
  splitComposerTokenSegments,
} from '@/components/chat/composer-highlight';

describe('composerTokenRanges / splitComposerTokenSegments', () => {
  it('T-HL1：$apm-recall 与 @/a.md 混排精确分段', () => {
    const plain = '$apm-recall 和 @/a.md 哦';

    expect(composerTokenRanges(plain)).toEqual([
      {start: 0, end: 11},
      {start: 14, end: 20},
    ]);
    expect(splitComposerTokenSegments(plain)).toEqual([
      {kind: 'token', text: '$apm-recall'},
      {kind: 'plain', text: ' 和 '},
      {kind: 'token', text: '@/a.md'},
      {kind: 'plain', text: ' 哦'},
    ]);
  });

  it('T-HL2：@a$b 字符类互斥不互吞，成两个独立 token', () => {
    // @ 分支的字符类排除 $，@a 止于 $ 前；$b 随后独立命中
    const plain = '@a$b';

    expect(composerTokenRanges(plain)).toEqual([
      {start: 0, end: 2},
      {start: 2, end: 4},
    ]);
    expect(splitComposerTokenSegments(plain)).toEqual([
      {kind: 'token', text: '@a'},
      {kind: 'token', text: '$b'},
    ]);
  });

  it('T-HL3：孤立 $ 不成 token，原文保留', () => {
    expect(splitComposerTokenSegments('a $ b')).toEqual([
      {kind: 'plain', text: 'a $ b'},
    ]);
    // 结尾 $ 同样不成 token
    expect(splitComposerTokenSegments('price: 100$')).toEqual([
      {kind: 'plain', text: 'price: 100$'},
    ]);
    expect(composerTokenRanges('a $ b')).toEqual([]);
  });

  it('T-HL4：a@b 无前置空白仍命中（桌面口径）', () => {
    expect(splitComposerTokenSegments('a@b')).toEqual([
      {kind: 'plain', text: 'a'},
      {kind: 'token', text: '@b'},
    ]);
    expect(composerTokenRanges('a@b')).toEqual([{start: 1, end: 3}]);
  });

  it('T-HL5：空串/纯文本原样单段', () => {
    expect(splitComposerTokenSegments('')).toEqual([
      {kind: 'plain', text: ''},
    ]);
    expect(splitComposerTokenSegments('纯文本，无 token')).toEqual([
      {kind: 'plain', text: '纯文本，无 token'},
    ]);
  });

  it('T-HL6：token 邻接边界——两 token 相邻无中间 plain 段', () => {
    // @ 分支止于 $ 前，$/x 紧随其后独立命中
    const plain = '@/a.md$/x';

    expect(splitComposerTokenSegments(plain)).toEqual([
      {kind: 'token', text: '@/a.md'},
      {kind: 'token', text: '$/x'},
    ]);
    expect(composerTokenRanges(plain)).toEqual([
      {start: 0, end: 6},
      {start: 6, end: 9},
    ]);
  });

  it('ranges 与 segments 一致性：token 段数与区间数相等、坐标逐段对齐、拼接还原原文', () => {
    const samples = [
      '$apm-recall 和 @/a.md 哦',
      '@a$b',
      'a $ b',
      'a@b',
      '',
      '纯文本',
      '@/a.md$/x',
      '帮我看 @/a.md 谢谢',
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
