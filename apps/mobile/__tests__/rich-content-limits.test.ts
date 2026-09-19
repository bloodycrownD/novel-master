/**
 * rich-content 超长阈值边界测试：
 * - 12k 仅约束 RN RenderHTML 兜底引擎（FlatList 护栏）；
 * - WebView 文档预览用放宽的 20 万字阈值——两三万字的小说章节不该被误判超长
 *   （2026-09-19 修复：超长回退曾把 fm-card HTML 按文本透出，阈值放宽后该
 *   回退面也大幅收窄）。
 */
import {
  RICH_CONTENT_MAX_CHARS,
  RICH_DOCUMENT_WEBVIEW_MAX_CHARS,
  isRichContentOverLimit,
  isWebViewDocumentOverLimit,
} from '@/components/rich-content/rich-content-limits';

describe('rich-content-limits', () => {
  it('RN 兜底引擎 12k：临界值不超、+1 超限', () => {
    expect(isRichContentOverLimit('a'.repeat(RICH_CONTENT_MAX_CHARS))).toBe(
      false,
    );
    expect(isRichContentOverLimit('a'.repeat(RICH_CONTENT_MAX_CHARS + 1))).toBe(
      true,
    );
  });

  it('WebView 引擎 20 万字：临界值不超、+1 超限', () => {
    expect(
      isWebViewDocumentOverLimit('a'.repeat(RICH_DOCUMENT_WEBVIEW_MAX_CHARS)),
    ).toBe(false);
    expect(
      isWebViewDocumentOverLimit('a'.repeat(RICH_DOCUMENT_WEBVIEW_MAX_CHARS + 1)),
    ).toBe(true);
  });

  it('两三万字正文对 WebView 不超限（用户场景回归锚点）', () => {
    const novel30k = '章'.repeat(30_000);
    expect(isWebViewDocumentOverLimit(novel30k)).toBe(false);
    // 同一正文对 RN 兜底引擎仍走原文回退——两道护栏各司其职
    expect(isRichContentOverLimit(novel30k)).toBe(true);
  });
});
