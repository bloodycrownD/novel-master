/**
 * Moves inline `color` from block tags onto an inner span so RenderHTML applies it to text nodes.
 * Block-level inline styles may not reach nested Text when defaultTextProps is set.
 */
export function liftInlineColorToInnerSpan(html: string): string {
  return html.replace(
    /<(p|div)\b([^>]*?)style=(["'])([\s\S]*?)\3([^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag, pre, quote, style, post, inner) => {
      const colorMatch = style.match(/color\s*:\s*[^;]+/i);
      if (colorMatch == null) {
        return full;
      }
      const colorDecl = colorMatch[0].trim();
      const restStyle = style
        .replace(/color\s*:\s*[^;]+;?/i, '')
        .replace(/^\s*;+\s*|\s*;+\s*$/g, '')
        .trim();
      const outerStyle = restStyle
        ? ` style=${quote}${restStyle}${quote}`
        : '';
      return `<${tag}${pre}${outerStyle}${post}><span style=${quote}${colorDecl}${quote}>${inner}</span></${tag}>`;
    },
  );
}
