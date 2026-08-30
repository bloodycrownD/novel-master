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
