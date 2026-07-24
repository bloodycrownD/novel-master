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
});
