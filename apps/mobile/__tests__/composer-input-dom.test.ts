/**
 * composer-input web 侧直测：高亮渲染（T-CW1..6）与编辑器纯逻辑（T-CW7..9）。
 *
 * 断言面全部是纯函数返回值——**不读源码文本**（Windows CRLF 会让
 * readFileSync 型断言误红）；DOM 装配与事件链由宿主层集成测试与模拟器验收覆盖。
 */
import {
  atomicDeleteRanges,
  renderHighlightHtml,
  resolveAtomicCaret,
  resolveAtomicDelete,
  resolveReportedHeight,
  resolveUnbounded,
  shouldReportChange,
} from '@web/composer-input/webview/runtime/editor';
import type {ComposerMetrics} from '@web/composer-input/webview/runtime/model';

const TOKEN_SPAN = (inner: string) =>
  `<span class="composer-input__token">${inner}</span>`;

const METRICS: ComposerMetrics = {
  fontSize: 16,
  lineHeight: 22,
  paddingH: 4,
  paddingV: 6,
  minHeight: 56,
  maxHeight: 160,
};

describe('renderHighlightHtml（composer-token 模式）', () => {
  it('T-CW1：非 token 段按 HTML 转义（& < > "）', () => {
    expect(renderHighlightHtml('<b>&"', 'composer-token')).toBe(
      '&lt;b&gt;&amp;&quot;',
    );
  });

  it('T-CW2：token 段包 span 且类名固定', () => {
    expect(renderHighlightHtml('看 @src/a.ts 谢谢', 'composer-token')).toBe(
      `看 ${TOKEN_SPAN('@src/a.ts')} 谢谢`,
    );
  });

  it('T-CW3：@a$b 互斥成两个独立 token（不互吞）', () => {
    expect(renderHighlightHtml('@a$b', 'composer-token')).toBe(
      `${TOKEN_SPAN('@a')}${TOKEN_SPAN('$b')}`,
    );
  });

  it('T-CW4：末尾换行补 <br/>（pre-wrap 下占位，防与 textarea 高度错位）', () => {
    expect(renderHighlightHtml('第一行\n', 'composer-token')).toBe(
      '第一行\n<br/>',
    );
    // 中间换行由 pre-wrap 自己占位，不补 br；末尾那个才补
    expect(renderHighlightHtml('a\nb\n', 'composer-token')).toBe('a\nb\n<br/>');
  });

  it('T-CW5：空串给零宽空格（行盒不塌）', () => {
    expect(renderHighlightHtml('', 'composer-token')).toBe('&#8203;');
    expect(renderHighlightHtml('', 'prompt-macro')).toBe('&#8203;');
  });

  it('孤立 $ 不成 token（后随空白/结尾）', () => {
    expect(renderHighlightHtml('价格 $ 100', 'composer-token')).toBe(
      '价格 $ 100',
    );
  });
});

describe('renderHighlightHtml（prompt-macro 模式）', () => {
  it('T-CW6：白名单宏包 span（手输形态含内文空格）', () => {
    expect(
      renderHighlightHtml('前缀 {{$time}} 与 {{ $week_cn }}', 'prompt-macro'),
    ).toBe(
      `前缀 ${TOKEN_SPAN('{{$time}}')} 与 ${TOKEN_SPAN('{{ $week_cn }}')}`,
    );
  });

  it('T-CW6：未闭合 {{ 不高亮', () => {
    expect(renderHighlightHtml('typing {{$time', 'prompt-macro')).toBe(
      'typing {{$time',
    );
  });

  it('T-CW6：非白名单/子键宏保持普通文本', () => {
    expect(
      renderHighlightHtml('{{$unknown}} {{$time.nested}}', 'prompt-macro'),
    ).toBe('{{$unknown}} {{$time.nested}}');
  });

  it('T-CW6：模式隔离——宏模式不认 @/$ token；token 模式无宏语义', () => {
    expect(renderHighlightHtml('@a $b', 'prompt-macro')).toBe('@a $b');
    // token 规则由字符类驱动（$ 后紧跟非空白即命中，以空白截止），不看 {{ }}：
    // 宏形态在 token 模式里只按 $ token 命中，尾部 }} 一起被吃掉
    expect(renderHighlightHtml('{{$time}}', 'composer-token')).toBe(
      `{{${TOKEN_SPAN('$time}}')}`,
    );
  });

  it('宏内文与其余文本同样走转义', () => {
    expect(renderHighlightHtml('a<b {{$time}}', 'prompt-macro')).toBe(
      `a&lt;b ${TOKEN_SPAN('{{$time}}')}`,
    );
  });
});

describe('atomicDeleteRanges / resolveAtomicDelete（T-CW7 原子删纯逻辑）', () => {
  it('token 源：退格命中 token 尾 → 整段摘除', () => {
    const prev = '看 @a.rb 好';
    const raw = '看 @a.r 好';
    expect(atomicDeleteRanges(prev, 'composer-token')).toEqual([
      {start: 2, end: 7},
    ]);
    expect(resolveAtomicDelete(prev, raw, 'composer-token')).toBe('看  好');
    expect(resolveAtomicCaret(prev, raw, '看  好')).toBe(2);
  });

  it('宏源：退格命中宏尾 → 整段摘除', () => {
    const prev = '前缀{{$time}}后缀';
    const raw = '前缀{{$time}后缀';
    expect(atomicDeleteRanges(prev, 'prompt-macro')).toEqual([
      {start: 2, end: 11, value: '{{$time}}'},
    ]);
    expect(resolveAtomicDelete(prev, raw, 'prompt-macro')).toBe('前缀后缀');
    expect(resolveAtomicCaret(prev, raw, '前缀后缀')).toBe(2);
  });

  it('双源互不串台（token 模式不认宏区间，反之亦然）', () => {
    // 同一段文本：宏模式命中整段摘除，token 模式无候选（内文 $ 后随空白）
    const macroPrev = '前缀{{ $time }}后缀';
    const macroRaw = '前缀{{ $time }后缀';
    expect(
      resolveAtomicDelete(macroPrev, macroRaw, 'composer-token'),
    ).toBeNull();
    expect(resolveAtomicDelete(macroPrev, macroRaw, 'prompt-macro')).toBe(
      '前缀后缀',
    );
    expect(
      resolveAtomicDelete('看 @a.rb 好', '看 @a.r 好', 'prompt-macro'),
    ).toBeNull();
  });

  it('非删除/整段覆盖/多处不连续删都不拦截（交内核默认差分）', () => {
    expect(
      resolveAtomicDelete('看 @a.rb', '看 @a.rb!', 'composer-token'),
    ).toBeNull();
    // 删除窗已覆盖整段区间
    expect(resolveAtomicDelete('@a', '', 'composer-token')).toBeNull();
    expect(
      resolveAtomicDelete('x@a b@c', 'x@a @c', 'composer-token'),
    ).toBeNull();
  });

  it('T-CW8：suppressChange 期间或内容相同 → 不上报 change', () => {
    expect(shouldReportChange('新', '旧', false)).toBe(true);
    expect(shouldReportChange('same', 'same', false)).toBe(false);
    expect(shouldReportChange('新', '旧', true)).toBe(false);
    expect(shouldReportChange('same', 'same', true)).toBe(false);
  });
});

describe('resolveReportedHeight（T-CW9 高度 clamp / 全屏跳过）', () => {
  it('min/max 双向 clamp', () => {
    expect(resolveReportedHeight(0, METRICS)).toBe(56);
    expect(resolveReportedHeight(100, METRICS)).toBe(100);
    expect(resolveReportedHeight(400, METRICS)).toBe(160);
  });

  it('maxHeight=null（chat 全屏）不上报', () => {
    expect(
      resolveReportedHeight(100, {...METRICS, maxHeight: null}),
    ).toBeNull();
  });
});

describe('resolveUnbounded（T-CW10 全屏铺满判定）', () => {
  // 回归背景：全屏（maxHeight=null）时容器若仍按内容高度流式布局，触摸区只到内容底部
  // （验收实测中部点击不达），需据此判定切换 `.composer-input--unbounded`（height:100%）。
  it('maxHeight=null → 不限高（需铺满视口）；数值或未给 → 限高', () => {
    expect(resolveUnbounded({...METRICS, maxHeight: null})).toBe(true);
    expect(resolveUnbounded(METRICS)).toBe(false);
    expect(resolveUnbounded({...METRICS, maxHeight: 176})).toBe(false);
  });
});
