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
import {sanitizeRichHtml} from '../src/components/rich-content/sanitize-rich-html';

const mockSanitizeHtml = sanitizeHtml as unknown as jest.Mock;

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
