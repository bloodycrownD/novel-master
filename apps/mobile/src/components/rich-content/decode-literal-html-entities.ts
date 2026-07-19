export type DecodeLiteralHtmlEntitiesOptions = {
  /**
   * 为 true 时不还原 `&lt;` / `&gt;`（及数值实体），供 sanitize 之后的出口路径使用，
   * 避免把 escape 后的伪标签再次变成裸尖括号。
   */
  preserveAngleBrackets?: boolean;
};

/**
 * 解码字面 HTML 实体（可多轮，处理双重编码如 `&amp;quot;`）。
 * @param text 输入文本
 * @param options.preserveAngleBrackets 出口路径传 true，保留尖括号实体
 */
export function decodeLiteralHtmlEntities(
  text: string,
  options?: DecodeLiteralHtmlEntitiesOptions,
): string {
  const preserveAngleBrackets = options?.preserveAngleBrackets === true;
  let current = text;
  let previous = '';
  let pass = 0;
  while (current !== previous && pass < 3) {
    previous = current;
    current = current
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#(?:0*34|x0*22);/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#(?:0*39|x0*27);/gi, "'");
    if (!preserveAngleBrackets) {
      current = current
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(?:0*60|x0*3c);/gi, '<')
        .replace(/&#(?:0*62|x0*3e);/gi, '>');
    }
    pass += 1;
  }
  return current;
}

/** Markdown 入口：完整解码实体（含尖括号），供 markdown-it 解析。 */
export function decodeForMarkdownInput(text: string): string {
  return decodeLiteralHtmlEntities(text);
}

/**
 * sanitize 出口：仍修复 quot/amp 双重编码，但保留 `&lt;` / `&gt;`，
 * 使 TrustedHtml 以实体形式展示用户可见尖括号。
 */
export function decodeAfterSanitize(text: string): string {
  return decodeLiteralHtmlEntities(text, {preserveAngleBrackets: true});
}

/** WebView boot 真源：`src/web/shared/decode-entities.ts`（须与本模块语义对齐）。 */
