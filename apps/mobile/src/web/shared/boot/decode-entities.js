/**
 * 遗留 assemble concat 用（Step 8 删除）。
 * 真源：`src/web/shared/decode-entities.ts` — 须保持行为一致。
 */
function decodeLiteralHtmlEntities(text) {
  var current = String(text || '');
  var previous = '';
  var pass = 0;
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
