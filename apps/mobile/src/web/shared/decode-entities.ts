/**
 * 解码字面 HTML 实体（供 escape 前归一化）。
 */
export function decodeLiteralHtmlEntities(text: unknown): string {
  let current = String(text || '');
  let previous = '';
  let pass = 0;
  while (current !== previous && pass < 3) {
    previous = current;
    current = current
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#(?:0*34|x0*22);/gi, '"')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&apos;/gi, "'")
      .replace(/&#(?:0*39|x0*27);/gi, "'");
    pass += 1;
  }
  return current;
}
