// @ts-nocheck
import { decodeLiteralHtmlEntities } from '../../shared/decode-entities';
/**
 * HTML 转义工具（供 stream-markdown 与行渲染共用）。
 */
export function escapeHtml(s) {
    return escapeHtmlRaw(decodeLiteralHtmlEntities(s));
  }

export function escapeHtmlRaw(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
