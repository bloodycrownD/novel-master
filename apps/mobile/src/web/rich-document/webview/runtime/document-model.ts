/**
 * rich-document 载荷与主题类型（runtime 模型）。
 */

export const BRIDGE_V = 1;
export const OVER_LIMIT_HINT = '内容过长，已显示原文';

/** 拼接 FM HTML（置于前）与正文，统一进 .doc-body；无 FM 时原样返回正文。 */
export function concatDocBodyHtml(
  frontMatterHtml: string,
  body: string,
): string {
  return frontMatterHtml ? `${frontMatterHtml}${body}` : body;
}

/**
 * DocumentApp 落 `.doc-body` 的分支描述（纯函数，供合约测试直测）：
 * - `html`：FM 与富文本正文拼成同一条 HTML，整体经 TrustedHtml；
 * - `plain`：FM 是 HTML 串须单独经 TrustedHtml，正文保持文本节点按原文显示
 *   （over-limit 回退）。绝不可把 fmHtml 拼进 text——HTML 会按字面透出。
 */
export type DocumentBody =
  | {
      readonly kind: 'html';
      readonly html: string;
      readonly layout: 'plain' | 'rich' | undefined;
    }
  | {
      readonly kind: 'plain';
      readonly fmHtml: string;
      readonly text: string;
    };

/** 由载荷选出 `.doc-body` 分支；无可显示内容时返回 null。 */
export function buildDocumentBody(
  payload: DocumentPayload,
): DocumentBody | null {
  const fm = payload.frontMatterHtml || '';
  if (payload.mode === 'html' && payload.html) {
    return {
      kind: 'html',
      html: concatDocBodyHtml(fm, payload.html),
      layout: payload.layout,
    };
  }
  if (payload.plain) {
    return {kind: 'plain', fmHtml: fm, text: payload.plain};
  }
  return null;
}

export type {HostTheme} from '@web/shared/host-theme';

export type DocumentPayload = {
  frontMatterHtml?: string;
  mode?: string;
  overLimit?: boolean;
  html?: string;
  plain?: string;
  /**
   * html 布局：`plain` 保留 pre-wrap（认锚文本 Tab）；缺省 / `rich` 为 Markdown 富文本。
   */
  layout?: 'plain' | 'rich';
};
