/**
 * LLMs / gateways sometimes emit literal &quot; or &amp;quot; in markdown prose.
 * markdown-it preserves &amp;quot;; sanitize-html does not decode it — decode first.
 */
export function decodeLiteralHtmlEntities(text: string): string {
  let current = text;
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

/** Inlined into WebView boot script — keep in sync with decodeLiteralHtmlEntities. */
export const DECODE_LITERAL_HTML_ENTITIES_BOOT = `
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
  }`.trim();
