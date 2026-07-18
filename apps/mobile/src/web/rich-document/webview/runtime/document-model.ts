/**
 * rich-document 载荷与主题类型（runtime 模型）。
 */

export const BRIDGE_V = 1;
export const OVER_LIMIT_HINT = '内容过长，已显示原文';

export type HostTheme = {
  background?: string;
  text?: string;
  textSecondary?: string;
  primary?: string;
  surface?: string;
  borderLight?: string;
};

export type DocumentPayload = {
  frontMatterHtml?: string;
  mode?: string;
  overLimit?: boolean;
  html?: string;
  plain?: string;
};
