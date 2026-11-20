/**
 * 解码字面 HTML 实体（供 escape 前归一化 / sanitize 出口修复）。
 *
 * 实现单源在 `common/text.ts` 的 `Text.decodeHtmlEntities`；RN 侧是它的薄入口
 * （`components/rich-content/decode-literal-html-entities.ts`），本文件是 WebView
 * 侧的镜像副本——WebView 构建门禁（build-webview.mjs 门 B）按白名单限制 core
 * 模块，不能自由引 core。两侧等价性由 `__tests__/decode-entities-parity.test.ts` 守护。
 */

export type DecodeLiteralHtmlEntitiesOptions = {
  /**
   * 为 true 时不还原 `&lt;` / `&gt;`（及数值实体），供 sanitize 之后的出口路径使用。
   */
  preserveAngleBrackets?: boolean;
};

export namespace DecodeEntities {
  /**
   * 解码字面 HTML 实体（可多轮，处理双重编码如 `&amp;quot;`）。
   * @param text 输入（允许非 string，会转成字符串）
   * @param options.preserveAngleBrackets 出口路径传 true，保留尖括号实体
   */
  export function literal(text: unknown, options?: DecodeLiteralHtmlEntitiesOptions): string {
    const preserveAngleBrackets = options?.preserveAngleBrackets === true;
    let current = String(text || '');
    let previous = '';
    let pass = 0;
    while (current !== previous && pass < 3) {
      previous = current;
      current = current.replace(/&amp;/gi, '&');
      current = current.replace(/&quot;/gi, '"');
      current = current.replace(/&#(?:0*34|x0*22);/gi, '"');
      current = current.replace(/&apos;/gi, "'");
      current = current.replace(/&#(?:0*39|x0*27);/gi, "'");
      if (!preserveAngleBrackets) {
        current = current.replace(/&lt;/gi, '<');
        current = current.replace(/&gt;/gi, '>');
        current = current.replace(/&#(?:0*60|x0*3c);/gi, '<');
        current = current.replace(/&#(?:0*62|x0*3e);/gi, '>');
      }
      pass += 1;
    }
    return current;
  }

  /** Markdown / 明文入口：完整解码实体（含尖括号）。 */
  // nm-style: keep-public — markdown 入口契约（chat-transcript webview 消费）
  export function forMarkdownInput(text: unknown): string {
    return literal(text);
  }

  /**
   * sanitize 出口：仍修复 quot/amp 双重编码，但保留 `&lt;` / `&gt;`。
   */
  export function afterSanitize(text: unknown): string {
    return literal(text, {preserveAngleBrackets: true});
  }
}
