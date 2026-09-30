import {
  composerTokenRanges,
} from '@/components/chat/composer-highlight';
import {tryAtomicRangeDelete} from '@/components/common/atomic-range-delete';
import {
  findWhitelistMacroRanges,
  tryAtomicMacroDelete,
} from '@/components/agent/prompt-macro-input';

/** 模拟退格一次：删掉 cursor 前一字 */
function backspaceOnce(value: string, cursor: number): string {
  if (cursor <= 0) {
    return value;
  }
  return value.slice(0, cursor - 1) + value.slice(cursor);
}

describe('tryAtomicRangeDelete', () => {
  it('T-AD1：token 区间内退格，整段删掉命中区间', () => {
    const prev = '看 $apm-recall 和 @/a.md 哦';
    // 在 $apm-recall 中段退格一次（删掉 '-'）
    const cursorInside = prev.indexOf('$apm-') + '$apm-'.length;
    const next = backspaceOnce(prev, cursorInside);

    expect(tryAtomicRangeDelete(prev, next, composerTokenRanges(prev))).toBe(
      '看  和 @/a.md 哦',
    );
  });

  it('T-AD1：手工区间与 token 区间命中行为一致', () => {
    const prev = 'x{/range}y';
    const next = backspaceOnce(prev, 5); // 区间 {start:1,end:9} 内退格

    expect(
      tryAtomicRangeDelete(prev, next, [{start: 1, end: 9}]),
    ).toBe('xy');
  });

  it('T-AD2：非删除（next 不短于 prev）返回 null', () => {
    const ranges = [{start: 0, end: 5}];

    expect(tryAtomicRangeDelete('ab', 'abc', ranges)).toBeNull();
    expect(tryAtomicRangeDelete('ab', 'ab', ranges)).toBeNull();
  });

  it('T-AD3：多处不连续删返回 null（尾段对账失败）', () => {
    // 分别删掉 'c' 与 'Z'，删除窗无法对齐为单段连续
    const prev = 'abcXYZdef';
    const next = 'abXYdef';
    const ranges = [{start: 2, end: 6}];

    expect(tryAtomicRangeDelete(prev, next, ranges)).toBeNull();
  });

  it('T-AD4：删除已覆盖整段区间返回 null（默认差分即可）', () => {
    // 选中整段 token 删除
    const prev = 'x @/a.md y';
    const next = 'x  y';
    expect(
      tryAtomicRangeDelete(prev, next, composerTokenRanges(prev)),
    ).toBeNull();

    // 删除范围超出区间两端（b + 整 token + c 一次删掉）
    const prev2 = 'a{/r}b';
    const next2 = 'ab';
    expect(
      tryAtomicRangeDelete(prev2, next2, [{start: 1, end: 5}]),
    ).toBeNull();
  });

  it('T-AD4：区间外删除不拦截返回 null', () => {
    const prev = '帮我看 @/a.md 谢谢';
    const next = backspaceOnce(prev, prev.length); // 删末尾「谢」
    expect(
      tryAtomicRangeDelete(prev, next, composerTokenRanges(prev)),
    ).toBeNull();
  });

  it('T-AD5：宏白名单区间源与 tryAtomicMacroDelete 逐组等价', () => {
    const macroCases: ReadonlyArray<readonly [string, string]> = [
      // 非删除
      ['{{$time}}', '{{$time}}x'],
      // 宏内退格（T-M1 语义）
      ['前缀{{$time}}后缀', '前缀{{$tim}}后缀'],
      // 手输完整宏退格（T-M3 语义）
      ['见 {{ $week_cn }} 后', '见 {{ $week_c }} 后'],
      // 非白名单宏退格不拦截（T-M4 语义）
      ['{{$unknown}}', '{{$unknown}'],
      // 多处不连续删
      ['a{{$time}}b{{$week_cn}}c', 'a{{$time}b{{$week_cn}c'],
      // 整段删完宏
      ['{{$time}}', ''],
    ];

    for (const [prev, next] of macroCases) {
      expect(
        tryAtomicRangeDelete(prev, next, findWhitelistMacroRanges(prev)),
      ).toBe(tryAtomicMacroDelete(prev, next));
    }
  });

  it('T-AD5：token 区间源与宏区间源行为模式一致（对称场景）', () => {
    // 区间内退格 → 整段删（token 侧）
    const prevToken = '帮我看 @/a.md 谢谢';
    const nextToken = backspaceOnce(
      prevToken,
      prevToken.indexOf('@/a.') + '/a.'.length,
    );
    expect(
      tryAtomicRangeDelete(prevToken, nextToken, composerTokenRanges(prevToken)),
    ).toBe('帮我看  谢谢');

    // 非删除 / 不连续删 / 整段覆盖 → null（token 侧）
    expect(
      tryAtomicRangeDelete(prevToken, prevToken, composerTokenRanges(prevToken)),
    ).toBeNull();
    expect(
      tryAtomicRangeDelete(
        '@a.md 和 $apm-recall',
        'a.md 和 $apm-recal',
        composerTokenRanges('@a.md 和 $apm-recall'),
      ),
    ).toBeNull();
    expect(
      tryAtomicRangeDelete(prevToken, '帮我看  谢谢', composerTokenRanges(prevToken)),
    ).toBeNull();
  });
});
