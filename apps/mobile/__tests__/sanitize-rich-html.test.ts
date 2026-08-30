/**
 * sanitizeRichHtml 合同：危险标签配置；批注锚 data-annotate-id 放行（T-SA6）。
 * sanitize-html 嵌套 ESM 在 RN Jest 下难直接加载，故 mock 并断言调用配置。
 */

jest.mock('sanitize-html', () => {
  const fn = jest.fn((html: string) => html);
  (fn as {defaults?: unknown}).defaults = {
    allowedTags: ['p', 'a', 'span', 'div'],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
    },
  };
  return fn;
});

import sanitizeHtml from 'sanitize-html';
import {
  filterInlineStyle,
  sanitizeRichHtml,
} from '../src/components/rich-content/sanitize-rich-html';

const mockSanitizeHtml = sanitizeHtml as unknown as jest.Mock;
// jest.mock 只接管配置断言用的替身；行为用例绕过 mock 直连真实库
// （transformIgnorePatterns 已把 sanitize-html 及其 ESM 依赖家簇纳入 babel transform）
const realSanitizeHtml = jest.requireActual('sanitize-html') as typeof sanitizeHtml;

describe('sanitizeRichHtml', () => {
  beforeEach(() => {
    mockSanitizeHtml.mockClear();
    mockSanitizeHtml.mockImplementation((html: string) => html);
  });

  it('调用 sanitize-html 时 disallowedTagsMode=escape', () => {
    sanitizeRichHtml('<p>x</p>');
    expect(mockSanitizeHtml).toHaveBeenCalledTimes(1);
    const opts = mockSanitizeHtml.mock.calls[0]![1] as Record<string, unknown>;
    expect(opts.disallowedTagsMode).toBe('escape');
    expect(opts.parseStyleAttributes).toBe(false);
  });

  it('T-SA6: allowedAttributes.span 显式含 data-annotate-id', () => {
    sanitizeRichHtml(
      '<span class="nm-annotate-anchor" data-annotate-id="ann-1">x</span>',
    );
    const opts = mockSanitizeHtml.mock.calls[0]![1] as {
      allowedAttributes: Record<string, string[]>;
    };
    expect(opts.allowedAttributes.span).toEqual(
      expect.arrayContaining(['data-annotate-id', 'class']),
    );
  });

  it('透传消毒结果（替身保留锚属性）', () => {
    mockSanitizeHtml.mockImplementation((html: string) => html);
    const out = sanitizeRichHtml(
      '<span class="nm-annotate-anchor" data-annotate-id="a1">hello</span>',
    );
    expect(out).toContain('data-annotate-id="a1"');
    expect(out).toContain('nm-annotate-anchor');
  });

  it('T-CB7: allowedAttributes.pre 放行 data-lang（语言标签伪元素宿主）', () => {
    sanitizeRichHtml('<pre data-lang="typescript"><code>x</code></pre>');
    const opts = mockSanitizeHtml.mock.calls[0]![1] as {
      allowedAttributes: Record<string, string[]>;
    };
    expect(opts.allowedAttributes.pre).toEqual(
      expect.arrayContaining(['data-lang', 'class']),
    );
  });

  it('T-CB7: 白名单不含事件属性，危险标签仍以 escape 处置（基线不放松）', () => {
    sanitizeRichHtml('<p onclick="x">y</p>');
    const opts = mockSanitizeHtml.mock.calls[0]![1] as {
      allowedAttributes: Record<string, string[]>;
      disallowedTagsMode: string;
    };
    const allAllowed = Object.values(opts.allowedAttributes).flat();
    expect(allAllowed).not.toContain('onclick');
    expect(allAllowed.every((attr) => !attr.startsWith('on'))).toBe(true);
    // script 在 DISALLOWED_TAGS 内，escape 模式下不可执行
    expect(opts.disallowedTagsMode).toBe('escape');
  });

  it('T-CB7: 透传替身下 hljs span 与 pre data-lang 均保留', () => {
    mockSanitizeHtml.mockImplementation((html: string) => html);
    const out = sanitizeRichHtml(
      '<pre data-lang="typescript"><code class="language-ts hljs"><span class="hljs-keyword">const</span> a = 1</code></pre>',
    );
    expect(out).toContain('data-lang="typescript"');
    expect(out).toContain('class="language-ts hljs"');
    expect(out).toContain('hljs-keyword');
  });
  it('代码块复制按钮 span.code-copy 经消毒保留（span+class 白名单内）', () => {
    const out = sanitizeRichHtml(
      '<pre data-lang="ts"><span class="code-copy"></span><code class="language-ts hljs">hi</code></pre>',
    );
    expect(out).toContain('<span class="code-copy"></span>');
    expect(out).toContain('data-lang="ts"');
  });
});

describe('sanitizeRichHtml（真实库行为）', () => {
  const sanitizeWithRealConfig = (html: string): string => {
    // 借道替身捕获真实传给 sanitize-html 的配置，再用真实库回放，
    // 保证行为断言不随替身 mock 漂移。
    let captured: Parameters<typeof realSanitizeHtml>[1] | undefined;
    mockSanitizeHtml.mockImplementationOnce((input: string, options: unknown) => {
      captured = options as Parameters<typeof realSanitizeHtml>[1];
      return input;
    });
    sanitizeRichHtml(html);
    expect(captured).toBeDefined();
    return realSanitizeHtml(html, captured!);
  };

  it('B-2: <style> 标签不在白名单，escape 为实体字面量且 CSS 规则不可生效（固定现状）', () => {
    const out = sanitizeWithRealConfig('<style>p{color:red}</style>');
    expect(out).toBe('&lt;style&gt;p{color:red}&lt;/style&gt;');
  });

  it('B-2: 恶意 style 中 position/inset 被剥离、background 保留（防全屏覆盖伪造）', () => {
    const out = sanitizeWithRealConfig(
      '<div style="position:fixed;inset:0;background:#fff">x</div>',
    );
    expect(out).toContain('background: #fff');
    expect(out).not.toContain('position');
    expect(out).not.toContain('inset');
  });

  it('B-2: 正常内联色值/对齐不受影响', () => {
    const out = sanitizeWithRealConfig(
      '<span style="color:#c00;text-align:center;font-weight:bold">x</span>',
    );
    expect(out).toContain('color: #c00');
    expect(out).toContain('text-align: center');
    expect(out).toContain('font-weight: bold');
  });

  it('B-2: 非白名单样式全剥时 style 属性整体移除', () => {
    const out = sanitizeWithRealConfig('<div style="position:fixed;top:0">x</div>');
    expect(out).toBe('<div>x</div>');
  });
});

describe('filterInlineStyle（CSS 属性白名单）', () => {
  it('白名单内声明放行并规范化，名单外声明剥离', () => {
    expect(filterInlineStyle('COLOR:red;  text-align : center')).toBe(
      'color: red; text-align: center',
    );
    expect(filterInlineStyle('position:fixed;inset:0;transform:translate(0,0);z-index:999'))
      .toBeUndefined();
    expect(filterInlineStyle('width:100vw;height:100vh')).toBeUndefined();
  });

  it('含 CSS 注释的声明整条丢弃（防 pos/**/ition 拼凑属性名）', () => {
    expect(filterInlineStyle('pos/**/ition:fixed;color:red')).toBe('color: red');
  });

  it('值内含 url() 的声明丢弃（background:url 可外联加载）', () => {
    expect(filterInlineStyle('background:url(https://evil.example/x.png)')).toBeUndefined();
    expect(filterInlineStyle('background:#fff')).toBe('background: #fff');
  });

  it('url() 值内的分号/逗号/引号不会破坏声明切分', () => {
    // url("a;b") 内的分号被引号保护，不切分；整条因含 url( 被丢，但 color 完整保留
    expect(filterInlineStyle('background:url("a;b,c");color:blue')).toBe('color: blue');
  });
});
