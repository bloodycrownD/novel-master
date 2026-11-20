import {DecodeEntities} from '@web/shared/decode-entities';
/**
 * HTML 转义工具（供 stream-markdown 与行渲染共用）。
 */
export const HtmlEscape = {
  escape: (s: unknown): string => {
    return HtmlEscape.escapeRaw(DecodeEntities.literal(s));
  },

  escapeRaw: (s: unknown): string => {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
} as const;
